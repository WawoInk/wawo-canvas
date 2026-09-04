import { Building2, Clapperboard, FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

import { enterpriseCapabilities, type EnterpriseIdentity } from "@/lib/account-access";
import type { PublicNavigationSettings } from "@/services/api/settings";

export const navigationTools = [
    {
        slug: "canvas",
        labelKey: "navigation.canvas",
        icon: Maximize2,
    },
    {
        slug: "storyboard",
        labelKey: "navigation.storyboard",
        icon: Clapperboard,
    },
    {
        slug: "image",
        labelKey: "navigation.image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        labelKey: "navigation.video",
        icon: Video,
    },
    {
        slug: "assets",
        labelKey: "navigation.assets",
        icon: Images,
    },
    {
        slug: "volcengine-assets",
        labelKey: "navigation.volcengineAssets",
        icon: Images,
    },
    {
        slug: "prompts",
        labelKey: "navigation.prompts",
        icon: FileText,
    },
] as const;

export const enterpriseNavigationTool = {
    slug: "enterprise-assets",
    labelKey: "navigation.enterpriseAssets",
    icon: Building2,
} as const;

export function navigationToolsForUser(user?: EnterpriseIdentity | null, visibility?: Partial<PublicNavigationSettings> | null) {
    if (visibility?.enabled === false) return [];
    const hidden = new Set([
        visibility?.canvas === false ? "canvas" : "",
        visibility?.storyboard === false ? "storyboard" : "",
        visibility?.image === false ? "image" : "",
        visibility?.video === false ? "video" : "",
        visibility?.assets === false ? "assets" : "",
        visibility?.volcengineAssets === false ? "volcengine-assets" : "",
        visibility?.prompts === false ? "prompts" : "",
    ]);
    const tools = enterpriseCapabilities(user).canAccessAssets ? [...navigationTools, enterpriseNavigationTool] : navigationTools;
    return tools.filter((tool) => !hidden.has(tool.slug));
}

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | typeof enterpriseNavigationTool.slug;
