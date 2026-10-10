package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"strconv"
	"strings"
)

func geminiImageRequest(body []byte, modelName, contentType string) ([]byte, error) {
	if readAIRequestCount(body, contentType) > 1 {
		return nil, fmt.Errorf("Gemini 图片暂不支持单次生成多张，请分次生成")
	}
	if strings.HasPrefix(contentType, "multipart/form-data") {
		_, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
		}
		form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
		if err != nil {
			return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
		}
		defer form.RemoveAll()
		if len(form.File["mask"]) > 0 || len(form.Value["mask"]) > 0 {
			return nil, fmt.Errorf("Gemini 图片不支持蒙版编辑")
		}
		fields := map[string]any{}
		for _, key := range []string{"prompt", "size", "background"} {
			if values := form.Value[key]; len(values) > 0 {
				fields[key] = values[0]
			}
		}
		references := []string{}
		for _, key := range []string{"image", "image[]"} {
			for _, header := range form.File[key] {
				file, err := header.Open()
				if err != nil {
					return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
				}
				data, err := io.ReadAll(file)
				_ = file.Close()
				if err != nil {
					return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
				}
				references = append(references, "data:"+header.Header.Get("Content-Type")+";base64,"+base64.StdEncoding.EncodeToString(data))
			}
		}
		fields["image"] = references
		body, err = json.Marshal(fields)
		if err != nil {
			return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
		}
	}
	var input struct {
		Prompt     string          `json:"prompt"`
		Size       string          `json:"size"`
		Mask       json.RawMessage `json:"mask"`
		Background string          `json:"background"`
		Contents   json.RawMessage `json:"contents"`
		Image      json.RawMessage `json:"image"`
		ImageArray json.RawMessage `json:"image[]"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
	}
	if len(input.Mask) > 0 && string(input.Mask) != "null" {
		return nil, fmt.Errorf("Gemini 图片不支持蒙版编辑")
	}
	if input.Background == "transparent" {
		return nil, fmt.Errorf("Gemini 图片不支持透明背景参数")
	}
	if len(input.Contents) > 0 {
		return body, nil
	}
	parts := []any{map[string]string{"text": input.Prompt}}
	for _, images := range []json.RawMessage{input.Image, input.ImageArray} {
		if len(images) == 0 {
			continue
		}
		var references []string
		if err := json.Unmarshal(images, &references); err != nil {
			var reference string
			if err := json.Unmarshal(images, &reference); err != nil {
				return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
			}
			references = []string{reference}
		}
		for _, reference := range references {
			header, data, ok := strings.Cut(reference, ",")
			if !ok || !strings.HasPrefix(header, "data:image/") || !strings.HasSuffix(header, ";base64") {
				return nil, fmt.Errorf("图片参考必须为 base64 图片")
			}
			if _, err := base64.StdEncoding.DecodeString(data); err != nil {
				return nil, fmt.Errorf("Gemini 图片请求参数格式不正确")
			}
			parts = append(parts, map[string]any{"inlineData": map[string]string{"mimeType": strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64"), "data": data}})
		}
	}
	imageConfig := map[string]string{}
	size := strings.ToLower(strings.TrimSpace(input.Size))
	dimensions := strings.Split(strings.ReplaceAll(size, ":", "x"), "x")
	if size != "" && size != "auto" {
		if len(dimensions) != 2 {
			return nil, fmt.Errorf("图片尺寸格式无效")
		}
		width, errW := strconv.ParseFloat(dimensions[0], 64)
		height, errH := strconv.ParseFloat(dimensions[1], 64)
		if errW != nil || errH != nil || width <= 0 || height <= 0 || math.IsNaN(width) || math.IsNaN(height) || math.IsInf(width, 0) || math.IsInf(height, 0) {
			return nil, fmt.Errorf("图片尺寸格式无效")
		}
		nearest, distance := "1:1", math.Inf(1)
		for _, ratio := range []string{"1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"} {
			var w, h float64
			_, _ = fmt.Sscanf(ratio, "%f:%f", &w, &h)
			if delta := math.Abs(w/h - width/height); delta < distance {
				nearest, distance = ratio, delta
			}
		}
		var ratioWidth, ratioHeight float64
		_, _ = fmt.Sscanf(nearest, "%f:%f", &ratioWidth, &ratioHeight)
		// 固定尺寸表允许 16 像素对齐误差，不允许改成另一种比例。
		unsupported := size != nearest
		if strings.Contains(size, "x") {
			unsupported = math.Abs(width-height*ratioWidth/ratioHeight) > 16 && math.Abs(height-width*ratioHeight/ratioWidth) > 16
		}
		if unsupported {
			return nil, fmt.Errorf("Gemini 不支持所选图片比例，请更换比例")
		}
		imageConfig["aspectRatio"] = nearest
		if strings.Contains(size, "x") {
			edge := math.Max(width, height)
			switch {
			case size == "2880x2880" || edge > 3072:
				imageConfig["imageSize"] = "4K"
			case size == "2016x864" || size == "864x2016":
				imageConfig["imageSize"] = "1K"
			case edge <= 768:
				imageConfig["imageSize"] = "512"
			case edge <= 1536:
				imageConfig["imageSize"] = "1K"
			default:
				imageConfig["imageSize"] = "2K"
			}
		}
	}
	generationConfig := map[string]any{"responseModalities": []string{"TEXT", "IMAGE"}}
	if len(imageConfig) > 0 {
		generationConfig["imageConfig"] = imageConfig
	}
	return json.Marshal(map[string]any{
		"contents":         []any{map[string]any{"role": "user", "parts": parts}},
		"generationConfig": generationConfig,
	})
}

func geminiImageResponse(body []byte) []byte {
	var payload struct {
		Error      json.RawMessage `json:"error"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					InlineData struct {
						Data string `json:"data"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return body
	}
	if len(payload.Error) > 0 && string(payload.Error) != "null" {
		return body
	}
	images := []map[string]string{}
	for _, candidate := range payload.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData.Data != "" {
				images = append(images, map[string]string{"b64_json": part.InlineData.Data})
			}
		}
	}
	result, _ := json.Marshal(map[string]any{"data": images})
	return result
}

func geminiImageAudit(body []byte) []byte {
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		return []byte(`{"omitted":"unparseable Gemini image payload"}`)
	}
	var redact func(any)
	redact = func(value any) {
		switch item := value.(type) {
		case map[string]any:
			for key, child := range item {
				if key == "b64_json" || key == "inlineData" || key == "inline_data" {
					item[key] = "[REDACTED]"
				} else {
					redact(child)
				}
			}
		case []any:
			for _, child := range item {
				redact(child)
			}
		}
	}
	redact(payload)
	result, _ := json.Marshal(payload)
	return result
}
