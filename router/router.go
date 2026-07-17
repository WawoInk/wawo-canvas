package router

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/middleware"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
)

func New() *gin.Engine {
	router := gin.Default()
	router.RedirectTrailingSlash = false
	_ = router.SetTrustedProxies(nil)
	api := router.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	api.POST("/auth/register", gin.WrapF(handler.Register))
	api.POST("/auth/login", gin.WrapF(handler.Login))
	api.GET("/auth/linux-do/authorize", gin.WrapF(handler.LinuxDoAuthorize))
	api.GET("/auth/linux-do/callback", gin.WrapF(handler.LinuxDoCallback))
	api.GET("/auth/me", middleware.OptionalAuth, gin.WrapF(handler.CurrentUser))
	api.GET("/settings", gin.WrapF(handler.Settings))
	api.GET("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	api.HEAD("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	// Callback webhook: no UserAuth — external providers have no session.
	api.POST("/v1/generation-tasks/callback", gin.WrapF(handler.HandleTaskCallback))
	api.POST("/v1/generations/callback", gin.WrapF(handler.GenerationCallback))
	v1 := api.Group("/v1", middleware.UserAuth)

	v1.GET("/model-profiles", gin.WrapF(handler.ModelProfiles))
	v1.POST("/generations", gin.WrapF(handler.CreateGeneration))
	v1.GET("/generations/:id", func(c *gin.Context) {
		handler.GetGeneration(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/generations/:id/cancel", func(c *gin.Context) {
		handler.CancelGeneration(c.Writer, c.Request, c.Param("id"))
	})

	// AI proxy routes — path captured via closure, no one-liner handlers needed
	proxy := func(path string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) { service.ProxyAIRequest(w, r, path) }
	}
	v1.POST("/images/generations", gin.WrapF(proxy("/images/generations")))
	v1.POST("/images/edits", gin.WrapF(proxy("/images/edits")))
	v1.POST("/async/images/generations", gin.WrapF(proxy("/async/images/generations")))
	v1.POST("/async/images/edits", gin.WrapF(proxy("/async/images/edits")))
	v1.POST("/chat/completions", gin.WrapF(proxy("/chat/completions")))
	v1.POST("/audio/speech", gin.WrapF(proxy("/audio/speech")))
	v1.POST("/xvanai/chat/completions", gin.WrapF(proxy("/chat/completions")))
	v1.POST("/videos", gin.WrapF(proxy("/videos")))

	v1.POST("/media/references", gin.WrapF(handler.UploadReferenceMedia))
	v1.GET("/videos/:id", func(c *gin.Context) {
		service.ProxyAIGetRequest(c.Writer, c.Request, "/videos/"+c.Param("id"))
	})
	v1.GET("/videos/:id/content", func(c *gin.Context) {
		service.ProxyAIGetRequest(c.Writer, c.Request, "/videos/"+c.Param("id")+"/content")
	})
	v1.GET("/tasks/:id", func(c *gin.Context) {
		service.ProxyAIGetRequest(c.Writer, c.Request, "/tasks/"+c.Param("id"))
	})
	v1.POST("/tasks/:id/cancel", func(c *gin.Context) {
		service.ProxyAIRequest(c.Writer, c.Request, "/tasks/"+c.Param("id")+"/cancel")
	})
	// Video generation standard entry (aligns with xvanai /v1/contents/generations/tasks).
	v1.POST("/contents/generations/tasks", gin.WrapF(handler.CreateVideoTask))
	v1.GET("/contents/generations/tasks/:id", func(c *gin.Context) {
		handler.GetVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/contents/generations/tasks/:id", func(c *gin.Context) {
		handler.CancelVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/contents/generations/tasks/:id/remix", func(c *gin.Context) {
		handler.RemixVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	// Generation task history
	v1.GET("/generation-tasks", gin.WrapF(handler.ListGenerationTasks))
	v1.POST("/generation-tasks", gin.WrapF(handler.RecordGenerationTask))
	v1.GET("/generation-tasks/:id", func(c *gin.Context) {
		handler.GetGenerationTaskDetail(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/generation-tasks/:id", func(c *gin.Context) {
		handler.DeleteGenerationTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/generation-tasks/:id/metadata", func(c *gin.Context) {
		handler.UpdateGenerationTaskMetadata(c.Writer, c.Request, c.Param("id"))
	})
	// User credit logs
	v1.GET("/credit-logs", gin.WrapF(handler.UserCreditLogs))
	// Delta sync (cursor-based)
	v1.GET("/sync", gin.WrapF(handler.Sync))
	// Canvas project sync
	v1.GET("/canvas/projects", gin.WrapF(handler.ListCanvasProjects))
	v1.POST("/canvas/projects", gin.WrapF(handler.CreateCanvasProject))
	v1.GET("/canvas/projects/:id", func(c *gin.Context) {
		handler.GetCanvasProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/canvas/projects/:id", func(c *gin.Context) {
		handler.UpdateCanvasProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/canvas/projects/:id", func(c *gin.Context) {
		handler.DeleteCanvasProject(c.Writer, c.Request, c.Param("id"))
	})
	// User assets (CRUD with user scope via UserAuth)
	v1.GET("/assets", gin.WrapF(handler.Assets))
	v1.POST("/assets", gin.WrapF(handler.SaveAsset))
	v1.DELETE("/assets/:id", func(c *gin.Context) {
		handler.DeleteAsset(c.Writer, c.Request, c.Param("id"))
	})
	// User file upload / S3 storage
	v1.POST("/files/upload-url", gin.WrapF(handler.CreateUploadURL))
	v1.POST("/files/confirm", gin.WrapF(handler.ConfirmUpload))
	v1.POST("/files", gin.WrapF(handler.UploadUserFileDirect))
	v1.POST("/files/proxy-upload", gin.WrapF(handler.ProxyUpload))
	v1.GET("/files", gin.WrapF(handler.ListUserFiles))
	v1.GET("/files/:id/content", func(c *gin.Context) {
		handler.DownloadUserFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/files/:id", func(c *gin.Context) {
		handler.GetUserFileByID(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/files/:id", func(c *gin.Context) {
		handler.DeleteUserFileHandler(c.Writer, c.Request, c.Param("id"))
	})
	api.GET("/prompts", middleware.OptionalAuth, gin.WrapF(handler.Prompts))
	api.GET("/assets", middleware.OptionalAuth, gin.WrapF(handler.Assets))
	api.POST("/admin/login", gin.WrapF(handler.AdminLogin))

	admin := api.Group("/admin", middleware.AdminAuth)
	admin.GET("/users", gin.WrapF(handler.AdminUsers))
	admin.POST("/users", gin.WrapF(handler.AdminSaveUser))
	admin.POST("/users/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustUserCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/users/:id", func(c *gin.Context) {
		handler.AdminDeleteUser(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/credit-logs", gin.WrapF(handler.AdminCreditLogs))
	admin.POST("/credit-logs", gin.WrapF(handler.AdminSaveCreditLog))
	admin.DELETE("/credit-logs/:id", func(c *gin.Context) {
		handler.AdminDeleteCreditLog(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/settings", gin.WrapF(handler.AdminSettings))
	admin.POST("/settings", gin.WrapF(handler.AdminSaveSettings))
	admin.POST("/settings/channel-models", gin.WrapF(handler.AdminChannelModels))
	admin.POST("/settings/channel-test", gin.WrapF(handler.AdminTestChannelModel))
	admin.GET("/prompt-categories", gin.WrapF(handler.AdminPromptCategories))
	admin.POST("/prompt-categories/sync", gin.WrapF(handler.AdminSyncPromptCategories))
	admin.GET("/prompts", gin.WrapF(handler.AdminPrompts))
	admin.POST("/prompts", gin.WrapF(handler.AdminSavePrompt))
	admin.POST("/prompts/batch-delete", gin.WrapF(handler.AdminDeletePrompts))
	admin.DELETE("/prompts/:id", func(c *gin.Context) {
		handler.AdminDeletePrompt(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/assets", gin.WrapF(handler.AdminAssets))
	admin.POST("/assets", gin.WrapF(handler.AdminSaveAsset))
	admin.POST("/assets/upload-image", gin.WrapF(handler.AdminUploadAssetImage))
	admin.DELETE("/assets/:id", func(c *gin.Context) {
		handler.AdminDeleteAsset(c.Writer, c.Request, c.Param("id"))
	})
	// Admin generation task detail (with payload access)
	admin.GET("/generation-tasks", gin.WrapF(handler.AdminListGenerationTasks))
	admin.GET("/generation-tasks/:id", func(c *gin.Context) {
		handler.AdminGetGenerationTaskDetail(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/generation-tasks/:id", func(c *gin.Context) {
		handler.AdminDeleteGenerationTask(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/generation-tasks/batch-delete", gin.WrapF(handler.AdminBatchDeleteGenerationTasks))

	router.NoRoute(middleware.NotFoundJSON)

	return router
}
