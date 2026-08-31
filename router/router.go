package router

import (
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/middleware"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
)

func querySafeLogFormatter(param gin.LogFormatterParams) string {
	param.Path = param.Request.URL.Path
	var statusColor, methodColor, resetColor string
	if param.IsOutputColor() {
		statusColor = param.StatusCodeColor()
		methodColor = param.MethodColor()
		resetColor = param.ResetColor()
	}
	if param.Latency > time.Minute {
		param.Latency = param.Latency.Truncate(time.Second)
	}
	return fmt.Sprintf("[GIN] %v |%s %3d %s| %13v | %15s |%s %-7s %s %#v\n%s",
		param.TimeStamp.Format("2006/01/02 - 15:04:05"),
		statusColor, param.StatusCode, resetColor,
		param.Latency,
		param.ClientIP,
		methodColor, param.Method, resetColor, param.Path,
		param.ErrorMessage,
	)
}

func querySafeRecovery(c *gin.Context, _ any) {
	fmt.Fprintf(gin.DefaultErrorWriter, "[GIN] panic recovered: path=%q\n%s", c.Request.URL.Path, debug.Stack())
	c.AbortWithStatus(http.StatusInternalServerError)
}

func New() *gin.Engine {
	router := gin.New()
	router.Use(gin.LoggerWithConfig(gin.LoggerConfig{Formatter: querySafeLogFormatter}), gin.CustomRecoveryWithWriter(nil, querySafeRecovery))
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
	registerVolcengineAdminGroupRoutes := func(group *gin.RouterGroup) {
		for _, action := range []string{"CreateAssetGroup", "ListAssetGroups", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup"} {
			groupAction := action
			group.POST("/doubao/open/"+groupAction, func(c *gin.Context) {
				handler.VolcengineAssetAdminGroupAction(c.Writer, c.Request, groupAction)
			})
		}
	}
	registerVolcengineUserRoutes := func(group *gin.RouterGroup) {
		group.GET("/volcengine-assets/outbounds", gin.WrapF(handler.VolcengineAssetOutbounds))
		group.POST("/volcengine-assets/upload", gin.WrapF(handler.VolcengineAssetLocalUpload))
		for _, action := range []string{"ListAssets", "GetAsset", "CreateAsset", "UpdateAsset", "DeleteAsset"} {
			assetAction := action
			group.POST("/doubao/open/"+assetAction, func(c *gin.Context) {
				handler.VolcengineAssetUserAction(c.Writer, c.Request, assetAction)
			})
		}
	}
	registerVolcengineAdminGroupRoutes(api.Group("/v1", middleware.AdminAuth))
	registerVolcengineAdminGroupRoutes(router.Group("/v1", middleware.AdminAuth))

	v1 := api.Group("/v1", middleware.UserAuth)
	registerVolcengineUserRoutes(v1)
	registerVolcengineUserRoutes(router.Group("/v1", middleware.UserAuth))

	v1.GET("/model-profiles", gin.WrapF(handler.ModelProfiles))
	v1.POST("/generations", gin.WrapF(handler.CreateGeneration))
	v1.GET("/generations/client-requests/:id", func(c *gin.Context) {
		handler.GetGenerationByClientRequestID(c.Writer, c.Request, c.Param("id"))
	})
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
	v1.PUT("/account/profile", gin.WrapF(handler.UpdateAccountProfile))
	v1.POST("/account/password", gin.WrapF(handler.ChangeAccountPassword))
	v1.PUT("/account/enterprise", gin.WrapF(handler.UpdateAccountEnterprise))
	v1.GET("/enterprise/summary", gin.WrapF(handler.EnterpriseAccountSummary))
	v1.GET("/enterprise/members", gin.WrapF(handler.EnterpriseMembers))
	v1.GET("/enterprise/credit-logs", gin.WrapF(handler.EnterpriseCreditLogs))
	v1.POST("/enterprise/members", gin.WrapF(handler.CreateEnterpriseMember))
	v1.POST("/enterprise/members/:id/status", func(c *gin.Context) {
		handler.SetEnterpriseMemberStatus(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/enterprise/members/:id/password", func(c *gin.Context) {
		handler.ResetEnterpriseMemberPassword(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/enterprise/assets", gin.WrapF(handler.EnterpriseAssets))
	v1.POST("/enterprise/assets", gin.WrapF(handler.CreateEnterpriseAsset))
	v1.GET("/enterprise/assets/:id", func(c *gin.Context) {
		handler.EnterpriseAsset(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/enterprise/assets/:id", func(c *gin.Context) {
		handler.UpdateEnterpriseAsset(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/enterprise/assets/:id", func(c *gin.Context) {
		handler.DeleteEnterpriseAsset(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/enterprise/assets/:id/copy", func(c *gin.Context) {
		handler.CopyEnterpriseAsset(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/enterprise/files", gin.WrapF(handler.UploadEnterpriseFile))
	v1.GET("/enterprise/files/:id/content", func(c *gin.Context) {
		handler.DownloadEnterpriseFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/enterprise/files/:id", func(c *gin.Context) {
		handler.GetEnterpriseFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/enterprise/files/:id", func(c *gin.Context) {
		handler.UpdateEnterpriseFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/enterprise/files/:id", func(c *gin.Context) {
		handler.DeleteEnterpriseFile(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/enterprise/members/:id/credits", func(c *gin.Context) {
		handler.TransferEnterpriseMemberCredits(c.Writer, c.Request, c.Param("id"))
	})
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
	// Storyboard Studio persistence
	v1.GET("/storyboards", gin.WrapF(handler.ListStoryboardProjects))
	v1.POST("/storyboards", gin.WrapF(handler.CreateStoryboardProject))
	v1.GET("/storyboards/:id", func(c *gin.Context) {
		handler.GetStoryboardProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/storyboards/:id", func(c *gin.Context) {
		handler.UpdateStoryboardProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/storyboards/:id", func(c *gin.Context) {
		handler.DeleteStoryboardProject(c.Writer, c.Request, c.Param("id"))
	})
	// Storyboard Brainstorm persistence
	v1.GET("/storyboards/:id/conversations", func(c *gin.Context) {
		handler.ListStoryboardBrainstormConversations(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/storyboards/:id/conversations", func(c *gin.Context) {
		handler.CreateStoryboardBrainstormConversation(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/storyboards/:id/conversations/:conversationId/title", func(c *gin.Context) {
		handler.RenameStoryboardBrainstormConversation(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"))
	})
	v1.DELETE("/storyboards/:id/conversations/:conversationId", func(c *gin.Context) {
		handler.DeleteStoryboardBrainstormConversation(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"))
	})
	v1.GET("/storyboards/:id/conversations/:conversationId/messages", func(c *gin.Context) {
		handler.ListStoryboardBrainstormMessages(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"))
	})
	v1.POST("/storyboards/:id/conversations/:conversationId/turns", func(c *gin.Context) {
		handler.CreateStoryboardBrainstormTurn(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"))
	})
	v1.PUT("/storyboards/:id/conversations/:conversationId/messages/:messageId/assistant", func(c *gin.Context) {
		handler.UpdateStoryboardBrainstormAssistant(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"), c.Param("messageId"))
	})
	v1.POST("/storyboards/:id/conversations/:conversationId/messages/:messageId/continue", func(c *gin.Context) {
		handler.ContinueStoryboardBrainstormAssistant(c.Writer, c.Request, c.Param("id"), c.Param("conversationId"), c.Param("messageId"))
	})
	v1.GET("/storyboards/:id/memories", func(c *gin.Context) {
		handler.ListStoryboardMemories(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/storyboards/:id/memories", func(c *gin.Context) {
		handler.CreateStoryboardMemory(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/storyboards/:id/memories/:memoryId", func(c *gin.Context) {
		handler.UpdateStoryboardMemory(c.Writer, c.Request, c.Param("id"), c.Param("memoryId"))
	})
	v1.DELETE("/storyboards/:id/memories/:memoryId", func(c *gin.Context) {
		handler.DeleteStoryboardMemory(c.Writer, c.Request, c.Param("id"), c.Param("memoryId"))
	})
	// Script Agent persistence
	v1.GET("/scripts", gin.WrapF(handler.ListScriptProjects))
	v1.POST("/scripts", gin.WrapF(handler.CreateScriptProject))
	v1.GET("/scripts/:id", func(c *gin.Context) {
		handler.GetScriptProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/scripts/:id", func(c *gin.Context) {
		handler.UpdateScriptProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.PUT("/scripts/:id/title", func(c *gin.Context) {
		handler.RenameScriptProject(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/scripts/:id", func(c *gin.Context) {
		handler.DeleteScriptProject(c.Writer, c.Request, c.Param("id"))
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

	// Reference-compatible alias for xvanai-new's safe outbound metadata path.
	api.GET("/user/assets/outbounds", middleware.UserAuth, gin.WrapF(handler.VolcengineAssetOutbounds))

	admin := api.Group("/admin", middleware.AdminAuth)
	admin.GET("/enterprises", gin.WrapF(handler.AdminEnterprises))
	admin.POST("/enterprises", gin.WrapF(handler.AdminCreateEnterprise))
	admin.POST("/enterprises/:id/status", func(c *gin.Context) {
		handler.AdminSetEnterpriseStatus(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/enterprises/:id/discount-rate", func(c *gin.Context) {
		handler.AdminSetEnterpriseDiscountRate(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/enterprises/:id/owner/status", func(c *gin.Context) {
		handler.AdminSetEnterpriseOwnerStatus(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/enterprises/:id/owner/password", func(c *gin.Context) {
		handler.AdminResetEnterpriseOwnerPassword(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/enterprises/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustEnterpriseOwnerCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/users", gin.WrapF(handler.AdminUsers))
	admin.POST("/users", gin.WrapF(handler.AdminSaveUser))
	admin.POST("/users/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustUserCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/users/:id", func(c *gin.Context) {
		handler.AdminDeleteUser(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/credit-logs", gin.WrapF(handler.AdminCreditLogs))
	admin.GET("/canvas-nodes", gin.WrapF(handler.AdminCanvasNodes))
	admin.POST("/credit-logs", gin.WrapF(handler.AdminSaveCreditLog))
	admin.DELETE("/credit-logs/:id", func(c *gin.Context) {
		handler.AdminDeleteCreditLog(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/settings", gin.WrapF(handler.AdminSettings))
	admin.POST("/settings", gin.WrapF(handler.AdminSaveSettings))
	admin.POST("/settings/channel-models", gin.WrapF(handler.AdminChannelModels))
	admin.POST("/settings/channel-test", gin.WrapF(handler.AdminTestChannelModel))
	admin.GET("/volcengine-assets/config", gin.WrapF(handler.AdminVolcengineAssetConfig))
	admin.POST("/volcengine-assets/config", gin.WrapF(handler.AdminSaveVolcengineAssetConfig))
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
	admin.POST("/generation-tasks/:id/refund", func(c *gin.Context) {
		handler.AdminRepairGenerationTaskRefund(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/generation-tasks/:id", func(c *gin.Context) {
		handler.AdminDeleteGenerationTask(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/generation-tasks/batch-delete", gin.WrapF(handler.AdminBatchDeleteGenerationTasks))

	router.NoRoute(middleware.NotFoundJSON)

	return router
}
