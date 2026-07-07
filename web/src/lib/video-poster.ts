/** Generate a poster image (data URL) from the first frame of a video. */
export function getVideoPoster(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.src = videoUrl;
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.playsInline = true;

        video.addEventListener("loadeddata", () => {
            video.currentTime = 0.1;
        });
        video.addEventListener("seeked", () => {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")!.drawImage(video, 0, 0);
            URL.revokeObjectURL(video.src);
            resolve(canvas.toDataURL("image/jpeg", 0.8));
        });
        video.addEventListener("error", () => {
            reject(new Error("无法加载视频首帧"));
        });
    });
}
