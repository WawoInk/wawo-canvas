import { Building2, FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

import { enterpriseCapabilities, type EnterpriseIdentity } from "@/lib/account-access";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
] as const;

export const enterpriseNavigationTool = {
    slug: "enterprise-assets",
    label: "企业素材库",
    icon: Building2,
} as const;

export function navigationToolsForUser(user?: EnterpriseIdentity | null) {
    return enterpriseCapabilities(user).canAccessAssets ? [...navigationTools, enterpriseNavigationTool] : navigationTools;
}

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | typeof enterpriseNavigationTool.slug;
