// ============================================================
// FRONTEND SCRIPT — Multi-Tenant Chatbot
// Riwayat tersimpan di PostgreSQL via server backend
// ============================================================

// ─── KONFIGURASI ─────────────────────────────────────────────
const API_KEY    = "key-klinik-123";         // ← Ganti sesuai tenant
const SERVER_URL = "http://localhost:8081";  // ← Sesuaikan PORT server

// ─── STATE ───────────────────────────────────────────────────
let sessions   = [];
let activeId   = null;
let isSending  = false;

// ─── API LAYER ───────────────────────────────────────────────

async function apiFetch(path, options = {}) {
    const res = await fetch(SERVER_URL + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            ...(options.headers || {})
        }
    });

    let data;
    try { data = await res.json(); }
    catch { throw new Error(`Server error HTTP ${res.status}`); }

    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    return data;
}

// ─── SESSION API ─────────────────────────────────────────────

async function fetchSessions() {
    const data = await apiFetch("/api/sessions");
    return data.sessions || [];
}

async function createSession(title = "Chat Baru") {
    const data = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title })
    });
    return data.session;
}

async function fetchMessages(sessionId) {
    const data = await apiFetch(`/api/sessions/${sessionId}/messages`);
    return data.messages || [];
}

async function deleteSessionAPI(sessionId) {
    await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

// ─── INIT ────────────────────────────────────────────────────

async function init() {
    try {
        sessions = await fetchSessions();
    } catch (err) {
        console.error("Gagal load sesi:", err.message);
        showConnectionError(err.message);
        sessions = [];
    }

    if (sessions.length === 0) {
        try {
            const s = await createSession("Chat Baru");
            sessions = [s];
            activeId = s.id;
        } catch (err) {
            console.error("Gagal buat sesi awal:", err.message);
        }
    } else {
        activeId = sessions[0].id;
    }

    renderSidebar();

    if (activeId) {
        await loadSessionMessages(activeId);
    } else {
        showWelcome();
    }
}

// ─── LOAD SESI ───────────────────────────────────────────────

async function loadSessionMessages(sessionId) {
    activeId = sessionId;
    clearMessages();

    try {
        const messages = await fetchMessages(sessionId);
        if (messages.length === 0) {
            showWelcome();
        } else {
            hideWelcome();
            messages.forEach(m => renderMessage(m.sender, m.content, false));
            scrollToBottom();
        }
    } catch (err) {
        console.error("Gagal load pesan:", err.message);
        showWelcome();
    }

    renderSidebar();
    closeSidebarMobile();
}

// ─── NEW CHAT ────────────────────────────────────────────────

async function startNewChat() {
    const current = sessions.find(s => s.id === activeId);
    const msgCount = parseInt(current?.message_count || 0);
    if (current && msgCount === 0) {
        clearMessages();
        showWelcome();
        renderSidebar();
        document.getElementById("msg")?.focus();
        return;
    }

    try {
        const s = await createSession("Chat Baru");
        sessions.unshift(s);
        activeId = s.id;
        clearMessages();
        showWelcome();
        renderSidebar();
        document.getElementById("msg")?.focus();
    } catch (err) {
        alert("Gagal membuat chat baru: " + err.message);
    }
}

// ─── DELETE SESI ─────────────────────────────────────────────

async function deleteSession(sessionId) {
    if (!confirm("Hapus percakapan ini?")) return;

    try {
        await deleteSessionAPI(sessionId);
        sessions = sessions.filter(s => s.id !== sessionId);

        if (activeId === sessionId) {
            activeId = null;
            clearMessages();

            if (sessions.length > 0) {
                activeId = sessions[0].id;
                await loadSessionMessages(activeId);
            } else {
                const s = await createSession("Chat Baru");
                sessions = [s];
                activeId = s.id;
                showWelcome();
            }
        }

        renderSidebar();
    } catch (err) {
        alert("Gagal menghapus: " + err.message);
    }
}

// ─── SEND PESAN ──────────────────────────────────────────────

async function send() {
    if (isSending) return;

    const input   = document.getElementById("msg");
    const sendBtn = document.getElementById("send-btn");
    if (!input || !sendBtn) return;

    const message = input.value.trim();
    if (!message) return;

    // Pastikan ada sesi aktif
    if (!activeId) {
        try {
            const s = await createSession(message.slice(0, 50));
            sessions.unshift(s);
            activeId = s.id;
            renderSidebar();
        } catch (err) {
            alert("Gagal membuat sesi: " + err.message);
            return;
        }
    }

    isSending = true;
    sendBtn.disabled = true;
    input.value = "";
    autoResizeTextarea();

    hideWelcome();
    renderMessage("user", message, true);
    showTyping();

    try {
        const data = await apiFetch("/api/chat", {
            method: "POST",
            body: JSON.stringify({ message, session_id: activeId })
        });

        hideTyping();
        renderMessage("bot", data.response, true);

        if (data.session_id && data.session_id !== activeId) {
            activeId = data.session_id;
        }

        try {
            sessions = await fetchSessions();
        } catch { /* tidak kritis */ }
        renderSidebar();

    } catch (err) {
        hideTyping();
        renderMessage("bot", "⚠️ " + err.message, true);
        console.error("[Send] Error:", err);
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        input.focus();
        scrollToBottom();
    }
}

// ─── RENDER HELPERS ──────────────────────────────────────────

function renderMessage(sender, text, animate) {
    const messagesEl = document.getElementById("messages");
    const typingEl   = document.getElementById("typing");
    if (!messagesEl) return;

    const div = document.createElement("div");
    div.className = `message ${sender}`;
    if (!animate) div.style.animation = "none";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (sender === "bot") {
        avatar.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
    } else {
        avatar.textContent = "U";
    }

    const body    = document.createElement("div");
    body.className = "msg-body";

    const label   = document.createElement("div");
    label.className = "msg-sender";
    label.textContent = sender === "bot" ? "gemini" : "you";

    const content = document.createElement("div");
    content.className = "msg-content";
    content.textContent = text;

    body.appendChild(label);
    body.appendChild(content);
    div.appendChild(avatar);
    div.appendChild(body);

    messagesEl.insertBefore(div, typingEl || null);
}

function clearMessages() {
    document.getElementById("messages")?.querySelectorAll(".message").forEach(m => m.remove());
}

function showWelcome() {
    const el = document.getElementById("welcome-screen");
    if (!el) return;
    el.style.display = "flex";
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
}

function hideWelcome() {
    const el = document.getElementById("welcome-screen");
    if (el) el.style.display = "none";
}

function showTyping() {
    document.getElementById("typing")?.classList.add("show");
    scrollToBottom();
}

function hideTyping() {
    document.getElementById("typing")?.classList.remove("show");
}

function scrollToBottom() {
    const w = document.getElementById("messages-wrapper");
    if (!w) return;
    setTimeout(() => w.scrollTo({ top: w.scrollHeight, behavior: "smooth" }), 60);
}

function showConnectionError(msg) {
    const c = document.getElementById("history-list");
    if (!c) return;
    c.innerHTML = `<div class="history-empty">
        <div class="history-empty-icon">⚠️</div>
        <div class="history-empty-text">
            Tidak bisa terhubung ke server.<br>
            <small style="opacity:.6">${escapeHtml(msg)}</small><br><br>
            <small>Pastikan server aktif di<br><b>${SERVER_URL}</b></small>
        </div></div>`;
}

// ─── SIDEBAR ─────────────────────────────────────────────────

function renderSidebar() {
    const container = document.getElementById("history-list");
    if (!container) return;
    container.innerHTML = "";

    if (!sessions.length) {
        container.innerHTML = `<div class="history-empty">
            <div class="history-empty-icon">💬</div>
            <div class="history-empty-text">Belum ada riwayat.<br>Mulai percakapan baru!</div>
        </div>`;
        return;
    }

    const groups = groupByTime(sessions);
    const labels = { today: "Hari ini", yesterday: "Kemarin", older: "Lebih lama" };

    ["today", "yesterday", "older"].forEach(key => {
        if (!groups[key].length) return;

        const group = document.createElement("div");
        group.className = "history-group";

        const lbl = document.createElement("div");
        lbl.className = "history-group-label";
        lbl.textContent = labels[key];
        group.appendChild(lbl);

        groups[key].forEach(session => {
            const item = document.createElement("div");
            item.className = "history-item" + (session.id === activeId ? " active" : "");

            const count = parseInt(session.message_count || 0);
            item.innerHTML = `
                <div class="history-icon">${pickIcon(session.title)}</div>
                <div class="history-info">
                    <div class="history-title">${escapeHtml(session.title || "Chat Baru")}</div>
                    <div class="history-meta">${formatRelTime(session.updated_at || session.created_at)} · ${count} pesan</div>
                </div>
                <button class="btn-del" title="Hapus" data-id="${session.id}">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/></svg>
                </button>`;

            item.addEventListener("click", e => {
                if (e.target.closest(".btn-del")) return;
                loadSessionMessages(session.id);
            });
            item.querySelector(".btn-del").addEventListener("click", e => {
                e.stopPropagation();
                deleteSession(session.id);
            });
            group.appendChild(item);
        });
        container.appendChild(group);
    });
}

// ─── SIDEBAR TOGGLE ──────────────────────────────────────────

let sidebarOpen = true;

function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    sidebarOpen = !sidebarOpen;
    if (window.innerWidth <= 700) {
        sidebar.classList.toggle("open", sidebarOpen);
        sidebar.classList.remove("collapsed");
        overlay.classList.toggle("show", sidebarOpen);
    } else {
        sidebar.classList.toggle("collapsed", !sidebarOpen);
    }
}

function closeSidebarMobile() {
    if (window.innerWidth > 700) return;
    sidebarOpen = false;
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebar-overlay")?.classList.remove("show");
}

function promptSuggestion(text) {
    const input = document.getElementById("msg");
    if (!input) return;
    input.value = text;
    autoResizeTextarea();
    input.focus();
}

function autoResizeTextarea() {
    const t = document.getElementById("msg");
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 180) + "px";
}

// ─── UTILS ───────────────────────────────────────────────────

function escapeHtml(str = "") {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function formatRelTime(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr), now = new Date();
    const mins = Math.floor((now - d) / 60000);
    const hrs  = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (mins < 1)   return "Baru saja";
    if (mins < 60)  return `${mins} mnt lalu`;
    if (hrs < 24)   return `${hrs} jam lalu`;
    if (days === 1) return "Kemarin";
    if (days < 7)   return `${days} hari lalu`;
    return d.toLocaleDateString("id-ID", { day:"numeric", month:"short" });
}

function groupByTime(list) {
    const g = { today:[], yesterday:[], older:[] };
    const now = new Date();
    const tod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yes = new Date(tod - 86400000);
    list.forEach(s => {
        const d = new Date(s.updated_at || s.created_at);
        if (d >= tod)      g.today.push(s);
        else if (d >= yes) g.yesterday.push(s);
        else               g.older.push(s);
    });
    return g;
}

function pickIcon(title = "") {
    const t = title.toLowerCase();
    if (/kode|code|debug/.test(t))    return "💻";
    if (/tulis|cerita|esai/.test(t))  return "✍️";
    if (/analisis|data/.test(t))      return "📊";
    if (/riset|cari/.test(t))         return "🔍";
    if (/ide|brainstorm/.test(t))     return "💡";
    return "💬";
}

// ─── MAIN ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    // Load nama tenant dari server
    try {
        const config = await apiFetch("/api/chatbot/config");
        const brandName = document.querySelector(".brand-name");
        if (brandName && config.tenant) {
            brandName.textContent = `Gemini — ${config.tenant}`;
        }
    } catch (err) {
        console.warn("Config tenant:", err.message);
    }

    await init();

    document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
    document.getElementById("sidebar-overlay")?.addEventListener("click", closeSidebarMobile);
    document.getElementById("btn-new-chat")?.addEventListener("click", startNewChat);
    document.getElementById("send-btn")?.addEventListener("click", send);

    const input = document.getElementById("msg");
    if (input) {
        input.addEventListener("input", autoResizeTextarea);
        input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });
        input.focus();
    }
});