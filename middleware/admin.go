package middleware

import (
	"net/http"
	"strings"

	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
)

func AdminAuth(c *gin.Context) {
	user, ok := authUser(c)
	if !ok || user.Role != model.UserRoleAdmin {
		handler.Fail(c.Writer, "未登录或权限不足")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func AdminKeyAuth(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	key := ""
	if values := c.Request.Header.Values("X-Admin-Key"); len(values) == 1 {
		key = values[0]
	}
	user, ok, err := service.CurrentAdminKeyUser(key)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		handler.FailError(c.Writer, err)
		c.Abort()
		return
	}
	if !ok {
		c.Status(http.StatusUnauthorized)
		handler.Fail(c.Writer, "Admin Key 无效或已失效")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func UserAuth(c *gin.Context) {
	user, ok := authUser(c)
	if !ok || user.Role == model.UserRoleGuest {
		handler.Fail(c.Writer, "未登录或权限不足")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func OptionalAuth(c *gin.Context) {
	if user, ok := authUser(c); ok {
		c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	}
	c.Next()
}

func NotFoundJSON(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"code": 1, "data": nil, "msg": "接口不存在"})
}

func authUser(c *gin.Context) (model.AuthUser, bool) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if strings.TrimSpace(token) == "" {
		return model.AuthUser{}, false
	}
	return service.CurrentAuthUser(token)
}
