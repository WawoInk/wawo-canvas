import i18n from "@/i18n";
import type { BrainstormAssistantStatus, BrainstormOutputItem } from "@/pages/storyboard/brainstorm-agent";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export type StoryboardBrainstormPageQuery = {
    page?: number;
    pageSize?: number;
};

export type StoryboardBrainstormConversation = {
    id: string;
    projectId: string;
    title: string;
    currentMessageId: string;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardBrainstormMessageBase = {
    id: string;
    projectId: string;
    conversationId: string;
    parentId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardBrainstormUserMessage = StoryboardBrainstormMessageBase & {
    role: "user";
    content: string;
    output: BrainstormOutputItem[];
};

export type StoryboardBrainstormAssistantMessage = StoryboardBrainstormMessageBase & {
    role: "assistant";
    output: BrainstormOutputItem[];
    status: BrainstormAssistantStatus;
    clientRequestId: string;
};

export type StoryboardBrainstormMessage = StoryboardBrainstormUserMessage | StoryboardBrainstormAssistantMessage;

export type StoryboardBrainstormConversationPage = {
    items: StoryboardBrainstormConversation[];
    total: number;
};

export type StoryboardBrainstormMessagePage = {
    conversation: StoryboardBrainstormConversation;
    items: StoryboardBrainstormMessage[];
    total: number;
};

export type StoryboardBrainstormTurn = {
    conversation: StoryboardBrainstormConversation;
    userMessage?: StoryboardBrainstormUserMessage;
    assistantMessage: StoryboardBrainstormAssistantMessage;
};

export type CreateStoryboardBrainstormConversationInput = {
    id: string;
    title?: string;
};

export type CreateStoryboardBrainstormTurnInput =
    | {
          mode: "append";
          clientRequestId: string;
          parentMessageId?: string;
          userMessage: { id: string; content: string };
          assistantMessageId: string;
      }
    | {
          mode: "regenerate";
          clientRequestId: string;
          targetMessageId: string;
          assistantMessageId: string;
      };

export type UpdateStoryboardBrainstormAssistantInput = {
    expectedRevision: number;
    status: BrainstormAssistantStatus;
    output: BrainstormOutputItem[];
};

export type ContinueStoryboardBrainstormAssistantInput = {
    clientRequestId: string;
    expectedRevision: number;
};

export type StoryboardMemoryScope = "project" | "scene" | "shot";

export type StoryboardMemory = {
    id: string;
    projectId: string;
    kind: string;
    scope: StoryboardMemoryScope;
    path: string;
    content: string;
    tags: string[];
    sourceMessageId: string;
    operationId: string;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardMemoryPage = {
    items: StoryboardMemory[];
    total: number;
};

export type StoryboardMemoryFields = {
    kind: string;
    scope: StoryboardMemoryScope;
    path: string;
    content: string;
    tags: string[];
    sourceMessageId?: string;
    operationId: string;
};

export type CreateStoryboardMemoryInput = StoryboardMemoryFields & { id: string };
export type UpdateStoryboardMemoryInput = StoryboardMemoryFields;

export type StoryboardBrainstormDeleteResult = {
    id: string;
    deletedAt: string;
};

function authToken() {
    const token = useUserStore.getState().token;
    if (!token) throw new Error(i18n.t("errors.authRequired"));
    return token;
}

export function fetchStoryboardBrainstormConversations(projectId: string, query: StoryboardBrainstormPageQuery = {}) {
    return apiGet<StoryboardBrainstormConversationPage>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations`, query, authToken());
}

export function createStoryboardBrainstormConversation(projectId: string, input: CreateStoryboardBrainstormConversationInput) {
    return apiPost<StoryboardBrainstormConversation>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations`, input, authToken());
}

export function renameStoryboardBrainstormConversation(projectId: string, conversationId: string, title: string) {
    return apiPut<StoryboardBrainstormConversation>(
        `/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/title`,
        { title },
        authToken(),
    );
}

export function deleteStoryboardBrainstormConversation(projectId: string, conversationId: string) {
    return apiDelete<StoryboardBrainstormDeleteResult>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`, authToken());
}

export function fetchStoryboardBrainstormMessages(projectId: string, conversationId: string, query: StoryboardBrainstormPageQuery = {}) {
    return apiGet<StoryboardBrainstormMessagePage>(
        `/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        query,
        authToken(),
    );
}

export function createStoryboardBrainstormTurn(projectId: string, conversationId: string, input: CreateStoryboardBrainstormTurnInput) {
    return apiPost<StoryboardBrainstormTurn>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/turns`, input, authToken());
}

export function updateStoryboardBrainstormAssistant(projectId: string, conversationId: string, messageId: string, input: UpdateStoryboardBrainstormAssistantInput) {
    return apiPut<StoryboardBrainstormAssistantMessage>(
        `/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/assistant`,
        input,
        authToken(),
    );
}

export function continueStoryboardBrainstormAssistant(projectId: string, conversationId: string, messageId: string, input: ContinueStoryboardBrainstormAssistantInput) {
    return apiPost<StoryboardBrainstormTurn>(
        `/api/v1/storyboards/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/continue`,
        input,
        authToken(),
    );
}

export function fetchStoryboardMemories(projectId: string, query: StoryboardBrainstormPageQuery = {}) {
    return apiGet<StoryboardMemoryPage>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/memories`, query, authToken());
}

export function createStoryboardMemory(projectId: string, input: CreateStoryboardMemoryInput) {
    return apiPost<StoryboardMemory>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/memories`, input, authToken());
}

export function updateStoryboardMemory(projectId: string, memoryId: string, input: UpdateStoryboardMemoryInput) {
    return apiPut<StoryboardMemory>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`, input, authToken());
}

export function deleteStoryboardMemory(projectId: string, memoryId: string) {
    return apiDelete<StoryboardBrainstormDeleteResult>(`/api/v1/storyboards/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`, authToken());
}
