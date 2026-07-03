package service

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	canvasConfig "github.com/basketikun/infinite-canvas/config"
)

var s3Client *s3.Client

// S3 返回全局 S3 客户端（延迟初始化）。
func S3() (*s3.Client, error) {
	if s3Client != nil {
		return s3Client, nil
	}
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(canvasConfig.Cfg.AmazonRegion),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			canvasConfig.Cfg.AmazonS3AccessKey,
			canvasConfig.Cfg.AmazonS3SecretKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("s3: %w", err)
	}
	s3Client = s3.NewFromConfig(cfg)
	return s3Client, nil
}

// S3Upload 上传数据到 S3（服务端直传，管理端素材图片等场景）。
func S3Upload(ctx context.Context, key string, reader io.Reader, mimeType string) (string, error) {
	client, err := S3()
	if err != nil {
		return "", err
	}
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s3Bucket()),
		Key:         aws.String(key),
		Body:        reader,
		ContentType: aws.String(mimeType),
	})
	if err != nil {
		return "", fmt.Errorf("s3 upload: %w", err)
	}
	return s3PublicURL(key), nil
}

// S3PresignPut 生成预签名上传 URL（前端直传 S3）。
func S3PresignPut(ctx context.Context, key, mimeType string, expires time.Duration) (string, error) {
	client, err := S3()
	if err != nil {
		return "", err
	}
	presignClient := s3.NewPresignClient(client)
	req, err := presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s3Bucket()),
		Key:         aws.String(key),
		ContentType: aws.String(mimeType),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", fmt.Errorf("s3 presign put: %w", err)
	}
	return req.URL, nil
}

// S3PresignGet 生成预签名下载 URL。
func S3PresignGet(ctx context.Context, key string, expires time.Duration) (string, error) {
	client, err := S3()
	if err != nil {
		return "", err
	}
	presignClient := s3.NewPresignClient(client)
	req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s3Bucket()),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", fmt.Errorf("s3 presign get: %w", err)
	}
	return req.URL, nil
}

// S3Delete 删除 S3 对象。
func S3Delete(ctx context.Context, key string) error {
	client, err := S3()
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s3Bucket()),
		Key:    aws.String(key),
	})
	return err
}

func s3Bucket() string {
	url := strings.TrimPrefix(canvasConfig.Cfg.AmazonS3URL, "https://")
	url = strings.TrimPrefix(url, "http://")
	return strings.SplitN(url, ".", 2)[0]
}

func s3PublicURL(key string) string {
	return fmt.Sprintf("%s/%s", strings.TrimRight(canvasConfig.Cfg.AmazonS3URL, "/"), key)
}
