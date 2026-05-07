-- ============================================================
-- MULTI-TENANT CHATBOT — PostgreSQL Schema
-- Shared Schema Architecture
-- ============================================================

-- Aktifkan ekstensi UUID (opsional tapi direkomendasikan)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- TABEL 1: tenants
-- Menyimpan semua data tenant (pelanggan SaaS)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id          VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    api_key     VARCHAR(100) NOT NULL UNIQUE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABEL 2: chatbot_configs
-- System Prompt & konfigurasi per tenant
-- WAJIB: kolom tenant_id sebagai foreign key
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_configs (
    id            SERIAL       PRIMARY KEY,
    tenant_id     VARCHAR(36)  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    system_prompt TEXT         NOT NULL,
    model         VARCHAR(50)  NOT NULL DEFAULT 'gemini-2.0-flash',
    temperature   FLOAT        NOT NULL DEFAULT 0.7,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id)  -- Satu konfigurasi per tenant
);

-- ─────────────────────────────────────────────
-- TABEL 3: chat_sessions
-- Sesi percakapan, terisolasi per tenant
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   VARCHAR(36)  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL DEFAULT 'Chat Baru',
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Index agar query WHERE tenant_id = ... cepat
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant ON chat_sessions(tenant_id);

-- ─────────────────────────────────────────────
-- TABEL 4: chat_messages
-- Riwayat pesan, terisolasi per tenant
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
    id          SERIAL       PRIMARY KEY,
    session_id  VARCHAR(36)  NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    tenant_id   VARCHAR(36)  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sender      VARCHAR(10)  NOT NULL CHECK (sender IN ('user', 'bot')),
    content     TEXT         NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Index ganda untuk isolasi + urutan
CREATE INDEX IF NOT EXISTS idx_messages_session  ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant   ON chat_messages(tenant_id);

-- ─────────────────────────────────────────────
-- DATA AWAL (SEED) — 2 Tenant dari modul praktikum
-- ─────────────────────────────────────────────
INSERT INTO tenants (id, name, api_key) VALUES
    ('t-001', 'Klinik Sehat',          'key-klinik-123'),
    ('t-002', 'Toko Sepatu Langkah',   'key-sepatu-456')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chatbot_configs (tenant_id, system_prompt) VALUES
    ('t-001', 'Anda adalah asisten medis dari Klinik Sehat. Jawab pertanyaan dengan empati, formal, dan profesional. Selalu anjurkan konsultasi dokter untuk diagnosa lebih lanjut.'),
    ('t-002', 'Anda adalah admin toko Sepatu Langkah yang gaul dan ramah. Jawab dengan santai, gunakan bahasa sehari-hari, dan bantu pelanggan menemukan sepatu yang cocok!')
ON CONFLICT (tenant_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- HELPER: Trigger auto-update kolom updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_configs_updated
    BEFORE UPDATE ON chatbot_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();