import { requestToolResponse } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import { runStoryboardPipeline, type StoryboardPipelineInput, type StoryboardStage } from "@/pages/storyboard/storyboard";

export function generateStoryboard(config: AiConfig, input: StoryboardPipelineInput, options?: { signal?: AbortSignal; onStage?: (stage: StoryboardStage) => void }) {
    return runStoryboardPipeline(
        input,
        (request) =>
            requestToolResponse(
                config,
                [{ role: "user", content: request.prompt }],
                [{ type: "function", function: { name: request.toolName, description: request.toolDescription, parameters: request.schema, strict: true } }],
                "required",
                undefined,
                { signal: options?.signal },
            ),
        options?.onStage,
    );
}
