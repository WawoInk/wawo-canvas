import { Building2, FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

import { enterpriseCapabilities, type EnterpriseIdentity } from "@/lib/account-access";

export const navigationTools = [
    {
        slug: "canvas",
        labelKey: "navigation.canvas",
        icon: Maximize2,
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
        slug: "prompts",
        labelKey: "navigation.prompts",
        icon: FileText,
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
] as const;

export const enterpriseNavigationTool = {
    slug: "enterprise-assets",
    labelKey: "navigation.enterpriseAssets",
    icon: Building2,
} as const;

export function navigationToolsForUser(user?: EnterpriseIdentity | null) {
    return enterpriseCapabilities(user).canAccessAssets ? [...navigationTools, enterpriseNavigationTool] : navigationTools;
}

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"] | typeof enterpriseNavigationTool.slug;
