package service

import (
	"context"
	"fmt"
	"io"
	"strings"

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

// S3Upload 上传数据到 S3 并返回公开访问 URL。
func S3Upload(ctx context.Context, key string, reader io.Reader, mimeType string) (string, error) {
	client, err := S3()
	if err != nil {
		return "", err
	}
	bucket := s3Bucket()
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        reader,
		ContentType: aws.String(mimeType),
	})
	if err != nil {
		return "", fmt.Errorf("s3 upload: %w", err)
	}
	return fmt.Sprintf("%s/%s", strings.TrimRight(canvasConfig.Cfg.AmazonS3URL, "/"), key), nil
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
