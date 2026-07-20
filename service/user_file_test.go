package service

import "testing"

func TestResultAudioIsAValidUserFileType(t *testing.T) {
	if !validFileTypes["results/audios"] {
		t.Fatal("results/audios should be accepted for generated audio files")
	}
}
