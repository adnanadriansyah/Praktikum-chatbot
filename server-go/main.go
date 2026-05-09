package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  TENANT CONFIG                                                               │
// └─────────────────────────────────────────────────────────────────────────────┘

// TenantConfig mendefinisikan konfigurasi per tenant.
type TenantConfig struct {
	Name         string
	SystemPrompt string
}

// tenants adalah registry semua tenant yang dikenali beserta x-api-key-nya.
// Kunci map = nilai header x-api-key yang dikirim oleh frontend.
var tenants = map[string]TenantConfig{
	"key-klinik-123": {
		Name: "Klinik Sehat",
		SystemPrompt: `Kamu adalah asisten virtual Klinik Sehat yang ramah, profesional, dan empatik.
Tugasmu adalah membantu pasien dan calon pasien dengan informasi seputar layanan klinik,
jadwal dokter, tips kesehatan umum, dan pertanyaan medis ringan.

ATURAN PENTING:
- Selalu sarankan konsultasi langsung dengan dokter untuk keluhan medis serius.
- Jangan pernah mendiagnosis penyakit secara definitif.
- Gunakan bahasa yang hangat, mudah dipahami, dan tidak menakutkan.
- Jawab dalam teks biasa tanpa markdown, simbol bintang, atau format khusus.
- Tulis dalam paragraf yang rapi dan mudah dibaca.`,
	},
	"key-sepatu-456": {
		Name: "Toko Sepatu Langkah",
		SystemPrompt: `Kamu adalah asisten penjualan Toko Sepatu Langkah yang antusias, berpengetahuan luas,
dan membantu pelanggan menemukan sepatu yang tepat.
Kamu ahli tentang berbagai jenis sepatu: sneakers, formal, sandal, sepatu olahraga, dll.

ATURAN PENTING:
- Bantu pelanggan menemukan pilihan sepatu berdasarkan kebutuhan, aktivitas, dan gaya.
- Berikan rekomendasi yang personal dan relevan.
- Promosikan produk dengan jujur, jangan melebih-lebihkan.
- Jawab dalam teks biasa tanpa markdown, simbol bintang, atau format khusus.
- Tulis dalam paragraf yang rapi dan ramah.`,
	},
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  REQUEST / RESPONSE TYPES                                                    │
// └─────────────────────────────────────────────────────────────────────────────┘

// ChatRequest adalah body JSON yang dikirim frontend.
type ChatRequest struct {
	Message string `json:"message"`
}

// ChatResponse adalah body JSON yang dikembalikan ke frontend.
type ChatResponse struct {
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  MIDDLEWARE HELPERS                                                          │
// └─────────────────────────────────────────────────────────────────────────────┘

// setCORSHeaders menyetel header CORS agar frontend bisa mengakses API dari browser.
func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, x-api-key")
}

// writeJSON menulis respons JSON dengan status code tertentu.
func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

// writeError menulis respons JSON error singkat.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, ChatResponse{Error: msg})
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  GEMINI CALLER                                                               │
// └─────────────────────────────────────────────────────────────────────────────┘

// callGemini mengirim pesan ke Gemini API dengan system prompt tenant yang sesuai.
// Mengembalikan teks respons atau error.
func callGemini(userMessage, systemPrompt, apiKey string) (string, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey

	requestBody := map[string]interface{}{
		"system_instruction": map[string]interface{}{
			"parts": []map[string]interface{}{
				{"text": systemPrompt},
			},
		},
		"contents": []map[string]interface{}{
			{
				"role": "user",
				"parts": []map[string]interface{}{
					{"text": userMessage},
				},
			},
		},
	}

	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}

	fmt.Printf("[Gemini] HTTP %d | Tenant system prompt (50 chars): %.50s...\n", resp.StatusCode, systemPrompt)

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	// Cek apakah Gemini API mengembalikan error
	if apiErr, ok := result["error"].(map[string]interface{}); ok {
		if msg, ok := apiErr["message"].(string); ok {
			return "", fmt.Errorf("gemini api error: %s", msg)
		}
		return "", fmt.Errorf("unknown gemini api error")
	}

	// Ekstrak teks dari respons
	candidates, ok := result["candidates"].([]interface{})
	if !ok || len(candidates) == 0 {
		return "Tidak ada respons dari AI.", nil
	}

	candidate, ok := candidates[0].(map[string]interface{})
	if !ok {
		return "Format respons tidak valid.", nil
	}

	content, ok := candidate["content"].(map[string]interface{})
	if !ok {
		return "Konten respons tidak ditemukan.", nil
	}

	parts, ok := content["parts"].([]interface{})
	if !ok || len(parts) == 0 {
		return "Bagian respons kosong.", nil
	}

	part, ok := parts[0].(map[string]interface{})
	if !ok {
		return "Format bagian respons tidak valid.", nil
	}

	text, ok := part["text"].(string)
	if !ok {
		return "Teks respons tidak ditemukan.", nil
	}

	return text, nil
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  HANDLER                                                                     │
// └─────────────────────────────────────────────────────────────────────────────┘

// chatHandler menangani POST /chat dengan validasi tenant via x-api-key.
func chatHandler(w http.ResponseWriter, r *http.Request) {
	setCORSHeaders(w)

	// Handle CORS preflight
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed. Gunakan POST.")
		return
	}

	// ── Validasi tenant via x-api-key ────────────────────────────────────────
	apiKeyHeader := r.Header.Get("x-api-key")
	if apiKeyHeader == "" {
		writeError(w, http.StatusUnauthorized, "Header x-api-key wajib disertakan.")
		return
	}

	tenant, knownTenant := tenants[apiKeyHeader]
	if !knownTenant {
		writeError(w, http.StatusForbidden, "x-api-key tidak dikenali atau tidak valid.")
		return
	}

	fmt.Printf("[Auth] Tenant terautentikasi: %s\n", tenant.Name)

	// ── Parse request body ───────────────────────────────────────────────────
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Body JSON tidak valid.")
		return
	}

	if req.Message == "" {
		writeError(w, http.StatusBadRequest, "Field 'message' tidak boleh kosong.")
		return
	}

	// ── Ambil Gemini API Key dari environment ────────────────────────────────
	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		writeError(w, http.StatusInternalServerError, "GEMINI_API_KEY belum dikonfigurasi di server.")
		return
	}

	// ── Panggil Gemini dengan system prompt tenant yang sesuai ───────────────
	responseText, err := callGemini(req.Message, tenant.SystemPrompt, geminiKey)
	if err != nil {
		fmt.Printf("[Error] callGemini: %v\n", err)
		writeError(w, http.StatusInternalServerError, "Gagal mendapatkan respons dari AI: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, ChatResponse{Response: responseText})
}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  MAIN                                                                        │
// └─────────────────────────────────────────────────────────────────────────────┘

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/chat", chatHandler)

	fmt.Printf("┌──────────────────────────────────────────┐\n")
	fmt.Printf("│  Multi-Tenant Chatbot API                │\n")
	fmt.Printf("│  Listening on http://localhost:%s        │\n", port)
	fmt.Printf("│  Tenants terdaftar: %d                    │\n", len(tenants))
	fmt.Printf("└──────────────────────────────────────────┘\n")

	for key, t := range tenants {
		fmt.Printf("  → [%s] %s\n", key, t.Name)
	}

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}