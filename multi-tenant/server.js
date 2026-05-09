/**
 * ============================================================
 * MULTI-TENANT CHATBOT SERVER
 * Integrasi: Express + PostgreSQL + Google Gemini API
 * Arsitektur: Shared Schema (satu DB, isolasi via tenant_id)
 * Port: 8081
 * ============================================================
 */

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ─────────────────────────────────────────────
// KONEKSI DATABASE POSTGRESQL
// ─────────────────────────────────────────────
const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'multitenant_chatbot',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Gagal terhubung ke PostgreSQL:', err.message);
        console.error('   Pastikan PostgreSQL berjalan dan .env sudah dikonfigurasi.');
    } else {
        release();
        console.log('✅ Terhubung ke PostgreSQL');
    }
});


// ─────────────────────────────────────────────
// MIDDLEWARE: IDENTIFIKASI & VALIDASI TENANT
// ─────────────────────────────────────────────
const tenantMiddleware = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                error: 'API Key tidak ditemukan.',
                hint:  'Sertakan header: x-api-key: <kunci_anda>'
            });
        }

        const result = await pool.query(
            'SELECT id, name, api_key FROM tenants WHERE api_key = $1 AND is_active = TRUE',
            [apiKey]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'API Key tidak valid atau tenant tidak aktif.'
            });
        }

        req.tenant = result.rows[0];
        next();
    } catch (err) {
        console.error('Middleware error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan server internal.' });
    }
};

app.use(tenantMiddleware);


// ─────────────────────────────────────────────
// HELPER: Panggil Gemini API
// ─────────────────────────────────────────────
async function callGemini(systemPrompt, userMessage, conversationHistory = []) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY belum dikonfigurasi di .env');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

    const contents = [];

    conversationHistory.forEach(msg => {
        contents.push({
            role:  msg.sender === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        });
    });

    contents.push({
        role:  'user',
        parts: [{ text: userMessage }]
    });

    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    };

    const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, tidak ada respons dari AI.';
}


// ─────────────────────────────────────────────
// ENDPOINT 1: Cek Konfigurasi Tenant
// GET /api/chatbot/config
// ─────────────────────────────────────────────
app.get('/api/chatbot/config', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT system_prompt, model, temperature FROM chatbot_configs WHERE tenant_id = $1',
            [req.tenant.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Konfigurasi chatbot belum dibuat untuk tenant ini.'
            });
        }

        res.json({
            message:      `Konfigurasi untuk: ${req.tenant.name}`,
            tenant:       req.tenant.name,
            systemPrompt: result.rows[0].system_prompt,
            model:        result.rows[0].model,
        });
    } catch (err) {
        console.error('GET /config error:', err);
        res.status(500).json({ error: 'Gagal mengambil konfigurasi.' });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 2: Daftar Semua Sesi Chat Tenant
// GET /api/sessions
// ─────────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, created_at, updated_at,
                    (SELECT COUNT(*) FROM chat_messages WHERE session_id = cs.id) AS message_count
             FROM chat_sessions cs
             WHERE tenant_id = $1
             ORDER BY updated_at DESC`,
            [req.tenant.id]
        );

        res.json({ sessions: result.rows });
    } catch (err) {
        console.error('GET /sessions error:', err);
        res.status(500).json({ error: 'Gagal mengambil sesi.' });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 3: Buat Sesi Chat Baru
// POST /api/sessions
// ─────────────────────────────────────────────
app.post('/api/sessions', async (req, res) => {
    try {
        const { title } = req.body;

        const result = await pool.query(
            `INSERT INTO chat_sessions (tenant_id, title)
             VALUES ($1, $2)
             RETURNING id, title, created_at`,
            [req.tenant.id, title || 'Chat Baru']
        );

        res.status(201).json({ session: result.rows[0] });
    } catch (err) {
        console.error('POST /sessions error:', err);
        res.status(500).json({ error: 'Gagal membuat sesi baru.' });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 4: Ambil Riwayat Pesan Sesi
// GET /api/sessions/:sessionId/messages
// ─────────────────────────────────────────────
app.get('/api/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const sessionCheck = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND tenant_id = $2',
            [sessionId, req.tenant.id]
        );

        if (sessionCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Sesi tidak ditemukan atau bukan milik Anda.' });
        }

        const result = await pool.query(
            'SELECT id, sender, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
            [sessionId]
        );

        res.json({ messages: result.rows });
    } catch (err) {
        console.error('GET /messages error:', err);
        res.status(500).json({ error: 'Gagal mengambil pesan.' });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 5: Kirim Pesan (Inti Chatbot)
// POST /api/chat
// Body: { message: "...", session_id: "..." }
// ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    try {
        const { message, session_id } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
        }

        const configResult = await pool.query(
            'SELECT system_prompt FROM chatbot_configs WHERE tenant_id = $1',
            [req.tenant.id]
        );

        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'Konfigurasi chatbot tidak ditemukan.' });
        }

        const systemPrompt = configResult.rows[0].system_prompt;

        let activeSessionId = session_id;

        if (activeSessionId) {
            const sessionCheck = await pool.query(
                'SELECT id FROM chat_sessions WHERE id = $1 AND tenant_id = $2',
                [activeSessionId, req.tenant.id]
            );
            if (sessionCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Session tidak valid atau bukan milik tenant ini.' });
            }
        } else {
            const newSession = await pool.query(
                `INSERT INTO chat_sessions (tenant_id, title) VALUES ($1, $2) RETURNING id`,
                [req.tenant.id, message.slice(0, 50)]
            );
            activeSessionId = newSession.rows[0].id;
        }

        const historyResult = await pool.query(
            'SELECT sender, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
            [activeSessionId]
        );
        const conversationHistory = historyResult.rows;

        await pool.query(
            'INSERT INTO chat_messages (session_id, tenant_id, sender, content) VALUES ($1, $2, $3, $4)',
            [activeSessionId, req.tenant.id, 'user', message]
        );

        const botReply = await callGemini(systemPrompt, message, conversationHistory);

        await pool.query(
            'INSERT INTO chat_messages (session_id, tenant_id, sender, content) VALUES ($1, $2, $3, $4)',
            [activeSessionId, req.tenant.id, 'bot', botReply]
        );

        await pool.query(
            `UPDATE chat_sessions
             SET updated_at = NOW(),
                 title = CASE WHEN title = 'Chat Baru' THEN $1 ELSE title END
             WHERE id = $2`,
            [message.slice(0, 50), activeSessionId]
        );

        res.json({
            response:   botReply,
            session_id: activeSessionId,
            tenant:     req.tenant.name
        });

    } catch (err) {
        console.error('POST /chat error:', err);
        res.status(500).json({ error: 'Terjadi kesalahan saat memproses pesan.', detail: err.message });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 6: Hapus Sesi
// DELETE /api/sessions/:sessionId
// ─────────────────────────────────────────────
app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const result = await pool.query(
            'DELETE FROM chat_sessions WHERE id = $1 AND tenant_id = $2 RETURNING id',
            [sessionId, req.tenant.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Sesi tidak ditemukan atau bukan milik Anda.' });
        }

        res.json({ message: 'Sesi berhasil dihapus.' });
    } catch (err) {
        console.error('DELETE /sessions error:', err);
        res.status(500).json({ error: 'Gagal menghapus sesi.' });
    }
});


// ─────────────────────────────────────────────
// ENDPOINT 7: Update Judul Sesi
// PATCH /api/sessions/:sessionId/title
// Body: { title: "Judul Baru" }
// ─────────────────────────────────────────────
app.patch('/api/sessions/:sessionId/title', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { title } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Judul tidak boleh kosong.' });
        }

        const result = await pool.query(
            `UPDATE chat_sessions SET title = $1, updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3 RETURNING id, title`,
            [title.trim(), sessionId, req.tenant.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        }

        res.json({ session: result.rows[0] });
    } catch (err) {
        console.error('PATCH /sessions/title error:', err);
        res.status(500).json({ error: 'Gagal mengupdate judul.' });
    }
});


// ─────────────────────────────────────────────
// JALANKAN SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`\n🚀 Server Multi-Tenant berjalan di http://localhost:${PORT}`);
    console.log(`   Tenant A (Klinik)   → x-api-key: key-klinik-123`);
    console.log(`   Tenant B (Toko)     → x-api-key: key-sepatu-456\n`);
});