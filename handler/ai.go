package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func AIImagesGenerations(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/images/generations")
}

func AIImagesEdits(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/images/edits")
}

func AIChatCompletions(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/chat/completions")
}

func AIAudioSpeech(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/audio/speech")
}

func AIVideos(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/videos")
}

func AIVideo(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/videos/"+id)
}

func AIVideoContent(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/videos/"+id+"/content")
}

func XvanaiChatCompletions(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/chat/completions")
}
