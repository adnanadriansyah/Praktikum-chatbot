package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

type Request struct {
	Message string `json:"message"`
}

type Response struct {
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

func chatHandler(w http.ResponseWriter, r *http.Request) {
	// CORS HEADERS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle preflight
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		http.Error(w, "API key not configured", http.StatusInternalServerError)
		return
	}

	url := "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey

	// System instruction: paksa Gemini balas dengan teks biasa tanpa markdown
	systemInstruction := map[string]interface{}{
		"parts": []map[string]interface{}{
			{
				"text": "Kamu adalah asisten yang membalas HANYA dengan teks biasa. " +
					"Jangan gunakan markdown sama sekali. " +
					"Jangan gunakan tanda bintang (*), double bintang (**), tanda pagar (#), " +
					"tanda underscore (_), backtick (`), bullet point, numbered list, " +
					"atau format apapun selain teks polos. " +
					"Tulis jawaban dalam paragraf biasa yang rapi dan mudah dibaca.",
			},
		},
	}

	body := map[string]interface{}{
		"system_instruction": systemInstruction,
		"contents": []map[string]interface{}{
			{
				"role": "user",
				"parts": []map[string]interface{}{
					{"text": req.Message},
				},
			},
		},
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "Failed to marshal request", http.StatusInternalServerError)
		return
	}

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to call Gemini API: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read response", http.StatusInternalServerError)
		return
	}

	fmt.Printf("Gemini API Response: %s\n", string(respBody))

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		http.Error(w, "Failed to parse API response", http.StatusInternalServerError)
		return
	}

	// Check for API error
	if errMsg, ok := result["error"]; ok {
		errDetail := ""
		if errMap, ok := errMsg.(map[string]interface{}); ok {
			if msg, ok := errMap["message"].(string); ok {
				errDetail = msg
			}
		}
		res := Response{Error: errDetail}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
		return
	}

	text := "Tidak ada respon dari AI"

	if candidates, ok := result["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if candidate, ok := candidates[0].(map[string]interface{}); ok {
			if content, ok := candidate["content"].(map[string]interface{}); ok {
				if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
					if part, ok := parts[0].(map[string]interface{}); ok {
						if textVal, ok := part["text"].(string); ok {
							text = textVal
						}
					}
				}
			}
		}
	}

	res := Response{Response: text}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	http.HandleFunc("/chat", chatHandler)

	fmt.Printf("Server starting on port %s\n", port)
	http.ListenAndServe(":"+port, nil)
}