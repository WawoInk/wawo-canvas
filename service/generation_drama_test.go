package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestViduDramaProfileContract(t *testing.T) {
	profile, ok := findGenerationProfile(GenerationProfiles(), "vidu-q3-drama")
	if !ok {
		t.Fatal("Vidu Drama profile is missing")
	}
	capabilities := profile.Capabilities
	if capabilities.Title == nil || !capabilities.Title.Required || capabilities.Title.MinLength != 1 || capabilities.Title.MaxLength != 20 {
		t.Fatalf("title constraints = %#v", capabilities.Title)
	}
	if capabilities.Script == nil || !capabilities.Script.Required || capabilities.Script.MinLength != 20 || capabilities.Script.MaxLength != 5000 || capabilities.Script.CJKMaxLength != 2000 {
		t.Fatalf("script constraints = %#v", capabilities.Script)
	}
	if capabilities.Assets == nil || !capabilities.Assets.Required || capabilities.Assets.Min != 1 || capabilities.Assets.Max != 14 {
		t.Fatalf("asset constraints = %#v", capabilities.Assets)
	}
	if !reflect.DeepEqual(capabilities.Assets.Roles, []model.ShortDramaAssetRole{model.ShortDramaAssetCharacter, model.ShortDramaAssetScene, model.ShortDramaAssetTool}) {
		t.Fatalf("asset roles = %#v", capabilities.Assets.Roles)
	}
	if !reflect.DeepEqual(capabilities.Assets.MimeTypes, []string{"image/png", "image/jpeg", "image/webp"}) {
		t.Fatalf("asset mime types = %#v", capabilities.Assets.MimeTypes)
	}
	settings := capabilities.Settings
	if len(settings) != 4 || !reflect.DeepEqual(settings["aspectRatio"].Values, []string{"16:9", "9:16"}) || !reflect.DeepEqual(settings["resolution"].Values, []string{"1080p"}) || settings["durationSeconds"].Default != "auto" || settings["durationSeconds"].Min == nil || *settings["durationSeconds"].Min != 8 || settings["durationSeconds"].Max == nil || *settings["durationSeconds"].Max != 12 {
		t.Fatalf("settings = %#v", settings)
	}
}

func TestCreateGenerationAcceptsAllViduDramaSettingValues(t *testing.T) {
	userID, asset := setupDramaValidationTest(t, "image/png")
	routeErr := errors.New("route reached")
	previousChannel := generationChannel
	defer func() { generationChannel = previousChannel }()
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, routeErr }

	values := []model.ScalarSettings{}
	for _, value := range []string{"16:9", "9:16"} {
		values = append(values, model.ScalarSettings{"aspectRatio": value})
	}
	values = append(values, model.ScalarSettings{"resolution": "1080p"}, model.ScalarSettings{"durationSeconds": "auto"})
	for value := 8; value <= 12; value++ {
		values = append(values, model.ScalarSettings{"durationSeconds": value})
	}
	for _, value := range []string{"standard", "high"} {
		values = append(values, model.ScalarSettings{"quality": value})
	}

	for index, settings := range values {
		_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, dramaCommand(fmt.Sprintf("valid-%d-%s", index, uuid.NewString()), asset, settings))
		if !errors.Is(err, routeErr) {
			t.Fatalf("settings %#v error = %v, want route reached", settings, err)
		}
	}
}

func TestCreateGenerationRejectsInvalidViduDramaInput(t *testing.T) {
	userID, asset := setupDramaValidationTest(t, "image/png")
	previousChannel := generationChannel
	defer func() { generationChannel = previousChannel }()
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, errors.New("must not route") }

	valid := dramaCommand("base", asset, nil)
	manyAssets := make([]model.ShortDramaAsset, 15)
	for index := range manyAssets {
		manyAssets[index] = asset
		manyAssets[index].SourceNodeID = fmt.Sprintf("image-%d", index)
		manyAssets[index].Reference.SourceNodeID = manyAssets[index].SourceNodeID
	}
	cases := []struct {
		name       string
		mutate     func(*model.GenerationCommand)
		code       string
		fieldPath  string
		resourceID string
	}{
		{"title too long", func(command *model.GenerationCommand) { command.Intent.Title = strings.Repeat("剧", 21) }, "INVALID_COMMAND", "intent.title", ""},
		{"script too short", func(command *model.GenerationCommand) { command.Intent.Script = strings.Repeat("a", 19) }, "INVALID_COMMAND", "intent.script", ""},
		{"Chinese script too long", func(command *model.GenerationCommand) { command.Intent.Script = strings.Repeat("剧", 2001) }, "INVALID_COMMAND", "intent.script", ""},
		{"too many assets", func(command *model.GenerationCommand) { command.Intent.Assets = manyAssets }, "INVALID_COMMAND", "intent.assets", ""},
		{"invalid role", func(command *model.GenerationCommand) { command.Intent.Assets[0].Role = "hero" }, "INVALID_COMMAND", "intent.assets.0.role", "image-1"},
		{"asset name too long", func(command *model.GenerationCommand) { command.Intent.Assets[0].Name = strings.Repeat("人", 31) }, "INVALID_COMMAND", "intent.assets.0.name", "image-1"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			command := valid
			command.ClientRequestID = testCase.name + "-" + uuid.NewString()
			command.Intent.Assets = append([]model.ShortDramaAsset(nil), valid.Intent.Assets...)
			testCase.mutate(&command)
			_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, command)
			assertGenerationValidationError(t, err, testCase.code, testCase.fieldPath, testCase.resourceID)
		})
	}

	invalidSettings := []model.ScalarSettings{
		{"aspectRatio": "1:1"}, {"resolution": "720p"}, {"durationSeconds": -1}, {"durationSeconds": 7}, {"durationSeconds": 13}, {"durationSeconds": 8.5}, {"quality": "ultra"}, {"generateAudio": true},
	}
	for index, settings := range invalidSettings {
		command := dramaCommand(fmt.Sprintf("invalid-setting-%d-%s", index, uuid.NewString()), asset, settings)
		_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, command)
		var validationErr GenerationValidationError
		if !errors.As(err, &validationErr) || validationErr.Code != "INVALID_SETTING" || !strings.HasPrefix(validationErr.FieldPath, "intent.settings.") || validationErr.Retryable {
			t.Fatalf("settings %#v error = %#v", settings, err)
		}
	}
}

func TestCreateGenerationReturnsLocatableDramaMediaErrors(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		mimeType   string
		fileID     string
		code       string
		fieldPath  string
		resourceID string
	}{
		{"unsupported format", "image/gif", "", "MEDIA_UNSUPPORTED", "intent.assets.0.reference.fileId", "image-1"},
		{"missing file", "image/png", "missing", "MEDIA_NOT_FOUND", "intent.assets.0.reference.fileId", "image-1"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			userID, asset := setupDramaValidationTest(t, testCase.mimeType)
			if testCase.fileID != "" {
				asset.Reference.FileID = testCase.fileID
			}
			_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, dramaCommand(testCase.name+"-"+uuid.NewString(), asset, nil))
			assertGenerationValidationError(t, err, testCase.code, testCase.fieldPath, testCase.resourceID)
		})
	}
}

func setupDramaValidationTest(t *testing.T, mimeType string) (string, model.ShortDramaAsset) {
	t.Helper()
	previousProfiles := generationProfiles
	generationProfiles = func() []model.GenerationProfile {
		profile, _ := findGenerationProfile(GenerationProfiles(), "vidu-q3-drama")
		return []model.GenerationProfile{profile}
	}
	t.Cleanup(func() { generationProfiles = previousProfiles })
	key := uuid.NewString()
	userID := "drama-validation-" + key
	fileID := "drama-file-" + key
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: userID, FileType: "images", S3Key: "images/" + key + ".png", OriginalName: "asset.png", MimeType: mimeType, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
		t.Fatalf("create user file: %v", err)
	}
	asset := model.ShortDramaAsset{SourceNodeID: "image-1", Role: model.ShortDramaAssetCharacter, Name: "林尘", Reference: model.MediaReference{FileID: fileID, SourceNodeID: "image-1", Name: "林尘"}}
	return userID, asset
}

func dramaCommand(requestID string, asset model.ShortDramaAsset, settings model.ScalarSettings) model.GenerationCommand {
	return model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: requestID, ModelProfileID: "vidu-q3-drama", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoShortDrama, Title: "测试短剧", Script: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。", Assets: []model.ShortDramaAsset{asset}, Settings: settings},
	}
}

func assertGenerationValidationError(t *testing.T, err error, code, fieldPath, resourceID string) {
	t.Helper()
	var validationErr GenerationValidationError
	if !errors.As(err, &validationErr) || validationErr.Code != code || validationErr.FieldPath != fieldPath || validationErr.ResourceID != resourceID || validationErr.Retryable {
		t.Fatalf("error = %#v, want code=%q fieldPath=%q resourceId=%q retryable=false", err, code, fieldPath, resourceID)
	}
}
