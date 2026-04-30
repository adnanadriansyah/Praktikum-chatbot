// ─── SESSION MANAGER ─────────────────────────────────────────────────────────
// Structure in localStorage:
//   gemini_sessions  → [ { id, title, createdAt, messages: [{sender, text, time}] } ]
//   gemini_active    → session id string

const SESSIONS_KEY = "gemini_sessions";
const ACTIVE_KEY   = "gemini_active";

let sessions = [];
let activeId  = null;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveSessions() {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function getSession(id) {
    return sessions.find(s => s.id === id) || null;
}

function getActiveSession() {
    return getSession(activeId);
}

function formatRelativeTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1)    return "Baru saja";
    if (diffMins < 60)   return `${diffMins} menit lalu`;
    if (diffHours < 24)  return `${diffHours} jam lalu`;
    if (diffDays === 1)  return "Kemarin";
    if (diffDays < 7)    return `${diffDays} hari lalu`;
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function groupSessionsByTime(list) {
    const groups = { today: [], yesterday: [], older: [] };
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yestStart  = new Date(todayStart - 86400000);

    list.forEach(s => {
        const d = new Date(s.createdAt);
        if (d >= todayStart)       groups.today.push(s);
        else if (d >= yestStart)   groups.yesterday.push(s);
        else                       groups.older.push(s);
    });
    return groups;
}

// ─── MARKDOWN PARSER ──────────────────────────────────────────────────────────

function parseMarkdown(text) {
    // Proses baris per baris agar lebih akurat
    const lines = text.split('\n');
    const output = [];
    let i = 0;
    let inCodeBlock = false;
    let codeLines = [];

    function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Proses inline: bold, italic, inline code
    function inlineFormat(s) {
        s = escHtml(s);
        // Inline code dulu (hindari proses isi backtick)
        s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        // Bold+italic ***text***
        s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        // Bold **text**
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic *text* — hanya jika tidak di awal baris (hindari list marker)
        s = s.replace(/(?<!\s)\*(?!\s)(.+?)(?<!\s)\*(?!\s)/g, '<em>$1</em>');
        return s;
    }

    while (i < lines.length) {
        const raw = lines[i];

        // ── Code block ──────────────────────────────────────
        if (raw.trim().startsWith('```')) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeLines = [];
            } else {
                inCodeBlock = false;
                output.push(`<pre class="code-block"><code>${escHtml(codeLines.join('\n'))}</code></pre>`);
                codeLines = [];
            }
            i++; continue;
        }
        if (inCodeBlock) {
            codeLines.push(raw);
            i++; continue;
        }

        // ── Heading ──────────────────────────────────────────
        const h3 = raw.match(/^###\s+(.+)/);
        const h2 = raw.match(/^##\s+(.+)/);
        const h1 = raw.match(/^#\s+(.+)/);
        if (h3) { output.push(`<h3 class="md-h3">${inlineFormat(h3[1])}</h3>`); i++; continue; }
        if (h2) { output.push(`<h2 class="md-h2">${inlineFormat(h2[1])}</h2>`); i++; continue; }
        if (h1) { output.push(`<h1 class="md-h1">${inlineFormat(h1[1])}</h1>`); i++; continue; }

        // ── Horizontal rule ──────────────────────────────────
        if (/^---+$/.test(raw.trim())) {
            output.push('<hr class="md-hr">');
            i++; continue;
        }

        // ── Unordered list (* item atau - item) ──────────────
        if (/^[\*\-]\s/.test(raw)) {
            const items = [];
            while (i < lines.length && /^[\*\-]\s/.test(lines[i])) {
                const content = lines[i].replace(/^[\*\-]\s+/, '');
                items.push(`<li>${inlineFormat(content)}</li>`);
                i++;
            }
            output.push(`<ul class="md-ul">${items.join('')}</ul>`);
            continue;
        }

        // ── Ordered list (1. 2. 3.) ──────────────────────────
        if (/^\d+\.\s/.test(raw)) {
            const items = [];
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                const content = lines[i].replace(/^\d+\.\s+/, '');
                items.push(`<li>${inlineFormat(content)}</li>`);
                i++;
            }
            output.push(`<ol class="md-ol">${items.join('')}</ol>`);
            continue;
        }

        // ── Indented list (    * item atau    - item) ─────────
        if (/^\s{2,}[\*\-]\s/.test(raw)) {
            const items = [];
            while (i < lines.length && /^\s{2,}[\*\-]\s/.test(lines[i])) {
                const content = lines[i].replace(/^\s+[\*\-]\s+/, '');
                items.push(`<li>${inlineFormat(content)}</li>`);
                i++;
            }
            output.push(`<ul class="md-ul md-ul-indent">${items.join('')}</ul>`);
            continue;
        }

        // ── Baris kosong ─────────────────────────────────────
        if (raw.trim() === '') {
            output.push('<br>');
            i++; continue;
        }

        // ── Paragraf biasa ───────────────────────────────────
        output.push(`<span>${inlineFormat(raw)}</span><br>`);
        i++;
    }

    return output.join('\n');
}

// ─── SIDEBAR RENDER ──────────────────────────────────────────────────────────

function renderSidebar() {
    const container = document.getElementById("history-list");
    if (!container) return;

    container.innerHTML = "";

    // Sort newest first
    const sorted = [...sessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">💬</div>
                <div class="history-empty-text">Belum ada riwayat chat.<br>Mulai percakapan baru!</div>
            </div>`;
        return;
    }

    const groups = groupSessionsByTime(sorted);
    const labels = { today: "Hari ini", yesterday: "Kemarin", older: "Lebih lama" };

    ["today", "yesterday", "older"].forEach(key => {
        if (groups[key].length === 0) return;

        const group = document.createElement("div");
        group.className = "history-group";

        const label = document.createElement("div");
        label.className = "history-group-label";
        label.textContent = labels[key];
        group.appendChild(label);

        groups[key].forEach(session => {
            const item = document.createElement("div");
            item.className = "history-item" + (session.id === activeId ? " active" : "");
            item.dataset.id = session.id;

            const firstMsg = session.messages.find(m => m.sender === "user");
            const text = firstMsg ? firstMsg.text : "";
            const icon = pickIcon(text);

            item.innerHTML = `
                <div class="history-icon">${icon}</div>
                <div class="history-info">
                    <div class="history-title">${escapeHtml(session.title)}</div>
                    <div class="history-meta">${formatRelativeTime(session.createdAt)} · ${session.messages.length} pesan</div>
                </div>
                <button class="btn-del" title="Hapus" data-id="${session.id}">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>`;

            item.addEventListener("click", (e) => {
                if (e.target.closest(".btn-del")) return;
                loadSession(session.id);
            });

            item.querySelector(".btn-del").addEventListener("click", (e) => {
                e.stopPropagation();
                deleteSession(session.id);
            });

            group.appendChild(item);
        });

        container.appendChild(group);
    });
}

function pickIcon(text) {
    const t = text.toLowerCase();
    if (/kode|code|debug|script|program|javascript|python/.test(t)) return "💻";
    if (/tulis|artikel|cerita|esai|write|story/.test(t)) return "✍️";
    if (/analisis|data|grafik|chart/.test(t)) return "📊";
    if (/riset|cari|search|topik/.test(t)) return "🔍";
    if (/ide|brainstorm|kreati/.test(t)) return "💡";
    if (/hitung|math|rumus|kalkulasi/.test(t)) return "🔢";
    return "💬";
}

function escapeHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── SESSION OPERATIONS ───────────────────────────────────────────────────────

function createNewSession() {
    const session = {
        id: genId(),
        title: "Chat baru",
        createdAt: new Date().toISOString(),
        messages: []
    };
    sessions.unshift(session);
    saveSessions();
    return session;
}

function setActiveSession(id) {
    activeId = id;
    localStorage.setItem(ACTIVE_KEY, id);
}

function loadSession(id) {
    const session = getSession(id);
    if (!session) return;

    setActiveSession(id);

    const messagesEl = document.getElementById("messages");
    const welcomeEl  = document.getElementById("welcome-screen");
    const typingEl   = document.getElementById("typing");

    messagesEl.querySelectorAll(".message").forEach(m => m.remove());

    if (session.messages.length === 0) {
        if (welcomeEl) welcomeEl.style.display = "flex";
    } else {
        if (welcomeEl) welcomeEl.style.display = "none";
        session.messages.forEach(msg => {
            const el = createMessageElement(msg.sender, msg.text);
            messagesEl.insertBefore(el, typingEl);
        });
        scrollToBottom();
    }

    renderSidebar();
    closeSidebarMobile();
}

function deleteSession(id) {
    if (!confirm("Hapus percakapan ini?")) return;

    sessions = sessions.filter(s => s.id !== id);
    saveSessions();

    if (id === activeId) {
        const welcomeEl = document.getElementById("welcome-screen");
        const messagesEl = document.getElementById("messages");
        messagesEl.querySelectorAll(".message").forEach(m => m.remove());
        if (welcomeEl) welcomeEl.style.display = "flex";

        if (sessions.length > 0) {
            setActiveSession(sessions[0].id);
            loadSession(sessions[0].id);
            return;
        } else {
            activeId = null;
            localStorage.removeItem(ACTIVE_KEY);
        }
    }

    renderSidebar();
}

function startNewChat() {
    const existing = getActiveSession();
    if (existing && existing.messages.length === 0) {
        const messagesEl = document.getElementById("messages");
        const welcomeEl  = document.getElementById("welcome-screen");
        messagesEl.querySelectorAll(".message").forEach(m => m.remove());
        if (welcomeEl) {
            welcomeEl.style.display = "flex";
            welcomeEl.style.animation = "none";
            void welcomeEl.offsetWidth;
            welcomeEl.style.animation = "";
        }
        renderSidebar();
        return;
    }

    const session = createNewSession();
    setActiveSession(session.id);

    const messagesEl = document.getElementById("messages");
    const welcomeEl  = document.getElementById("welcome-screen");
    messagesEl.querySelectorAll(".message").forEach(m => m.remove());
    if (welcomeEl) {
        welcomeEl.style.display = "flex";
        welcomeEl.style.animation = "none";
        void welcomeEl.offsetWidth;
        welcomeEl.style.animation = "";
    }

    renderSidebar();
    document.getElementById("msg").focus();
}

// ─── MESSAGE HELPERS ──────────────────────────────────────────────────────────

function createMessageElement(sender, text) {
    const div = document.createElement("div");
    div.className = `message ${sender}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (sender === "bot") {
        avatar.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
    } else {
        avatar.textContent = "U";
    }

    const body = document.createElement("div");
    body.className = "msg-body";

    const senderLabel = document.createElement("div");
    senderLabel.className = "msg-sender";
    senderLabel.textContent = sender === "bot" ? "gemini" : "you";

    const content = document.createElement("div");
    content.className = "msg-content";

    // Gunakan parseMarkdown hanya untuk pesan bot
    if (sender === "bot") {
        content.innerHTML = parseMarkdown(text);
    } else {
        // Pesan user: cukup escape HTML dan ganti newline
        content.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
    }

    body.appendChild(senderLabel);
    body.appendChild(content);
    div.appendChild(avatar);
    div.appendChild(body);
    return div;
}

function addMessage(sender, text) {
    const messagesEl = document.getElementById("messages");
    const welcomeEl  = document.getElementById("welcome-screen");
    const typingEl   = document.getElementById("typing");
    if (!messagesEl) return;

    if (!activeId) {
        const s = createNewSession();
        setActiveSession(s.id);
    }

    if (welcomeEl) welcomeEl.style.display = "none";

    const el = createMessageElement(sender, text);
    messagesEl.insertBefore(el, typingEl);

    const session = getActiveSession();
    if (session) {
        session.messages.push({ sender, text, time: new Date().toISOString() });

        if (sender === "user" && session.messages.filter(m => m.sender === "user").length === 1) {
            session.title = text.length > 40 ? text.slice(0, 40) + "…" : text;
        }

        saveSessions();
        renderSidebar();
    }

    scrollToBottom();
}

function showTyping() {
    const el = document.getElementById("typing");
    if (el) el.classList.add("show");
    scrollToBottom();
}

function hideTyping() {
    const el = document.getElementById("typing");
    if (el) el.classList.remove("show");
}

function scrollToBottom() {
    const w = document.getElementById("messages-wrapper");
    if (!w) return;
    setTimeout(() => w.scrollTo({ top: w.scrollHeight, behavior: "smooth" }), 60);
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

function send() {
    const input   = document.getElementById("msg");
    const sendBtn = document.getElementById("send-btn");
    if (!input || !sendBtn) return;

    const message = input.value.trim();
    if (!message) return;

    sendBtn.disabled = true;
    addMessage("user", message);
    input.value = "";
    autoResizeTextarea();
    showTyping();

    fetch("http://localhost:8080/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
    })
        .then(res => {
            if (!res.ok) throw new Error("Server error: " + res.statusText);
            return res.json();
        })
        .then(data => {
            hideTyping();
            addMessage("bot", data.response || data.error || "Maaf, terjadi kesalahan.");
        })
        .catch(err => {
            hideTyping();
            addMessage("bot", "⚠️ Gagal terhubung ke server. Pastikan server berjalan di localhost:8080.");
            console.error(err);
        })
        .finally(() => {
            sendBtn.disabled = false;
            input.focus();
        });
}

// ─── SIDEBAR TOGGLE ───────────────────────────────────────────────────────────

let sidebarOpen = true;

function toggleSidebar() {
    const sidebar  = document.getElementById("sidebar");
    const overlay  = document.getElementById("sidebar-overlay");
    const isMobile = window.innerWidth <= 700;

    if (isMobile) {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle("open", sidebarOpen);
        sidebar.classList.remove("collapsed");
        overlay.classList.toggle("show", sidebarOpen);
    } else {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle("collapsed", !sidebarOpen);
    }
}

function closeSidebarMobile() {
    if (window.innerWidth > 700) return;
    sidebarOpen = false;
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");
}

// ─── MISC ─────────────────────────────────────────────────────────────────────

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

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    try {
        sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    } catch (e) {
        sessions = [];
    }
    const savedActive = localStorage.getItem(ACTIVE_KEY);

    if (savedActive && getSession(savedActive)) {
        setActiveSession(savedActive);
        loadSession(savedActive);
    } else if (sessions.length > 0) {
        const newest = [...sessions].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        setActiveSession(newest.id);
        loadSession(newest.id);
    } else {
        const s = createNewSession();
        setActiveSession(s.id);
    }

    renderSidebar();

    document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebar);
    document.getElementById("sidebar-overlay").addEventListener("click", closeSidebarMobile);
    document.getElementById("btn-new-chat").addEventListener("click", startNewChat);

    const input = document.getElementById("msg");
    input.addEventListener("input", autoResizeTextarea);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    document.getElementById("send-btn").addEventListener("click", send);
    input.focus();
});