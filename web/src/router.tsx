import { useLayoutEffect } from "react";
import { createBrowserRouter, Outlet, useLocation, useNavigate } from "react-router-dom";

import { ClientRootInit } from "@/components/layout/client-root-init";
import i18n, { localeFromPathname, localeHref, resolveLanguage } from "@/i18n";

import UserLayout from "@/layouts/user-layout";
import AdminLayout from "@/layouts/admin-layout";
import HomePage from "@/pages/home";
import LoginPage from "@/pages/login";
import CanvasListPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";
import PromptsPage from "@/pages/prompts";
import AssetsPage from "@/pages/assets";
import AssetLibraryPage from "@/pages/asset-library";
import AccountPage from "@/pages/account";
import EnterpriseAssetsPage from "@/pages/enterprise-assets";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminEnterprises from "@/pages/admin/enterprises";
import AdminCreditLogs from "@/pages/admin/credit-logs";
import AdminGenerationTasks from "@/pages/admin/generation-tasks";
import AdminCanvasNodes from "@/pages/admin/canvas-nodes";
import AdminPrompts from "@/pages/admin/prompts";
import AdminAssets from "@/pages/admin/assets";
import AdminSettings from "@/pages/admin/settings";
import NotFound from "@/pages/not-found";

function LocaleBoundary() {
    const location = useLocation();
    const navigate = useNavigate();
    const locale = localeFromPathname(location.pathname);
    const language = resolveLanguage(i18n.resolvedLanguage || i18n.language);

    useLayoutEffect(() => {
        if (!locale) {
            navigate(localeHref(location, language), { replace: true });
            return;
        }
        if (locale !== language) void i18n.changeLanguage(locale);
    }, [language, locale, location, navigate]);

    return (
        <ClientRootInit>
            <Outlet />
        </ClientRootInit>
    );
}

export const router = createBrowserRouter([
    {
        path: "/:locale?",
        element: <LocaleBoundary />,
        children: [
            {
                element: (
                    <UserLayout>
                        <Outlet />
                    </UserLayout>
                ),
                children: [
                    { index: true, element: <HomePage /> },
                    { path: "login", element: <LoginPage /> },
                    { path: "canvas", element: <CanvasListPage /> },
                    { path: "canvas/:id", element: <CanvasProjectPage /> },
                    { path: "image", element: <ImagePage /> },
                    { path: "video", element: <VideoPage /> },
                    { path: "prompts", element: <PromptsPage /> },
                    { path: "assets", element: <AssetsPage /> },
                    { path: "asset-library", element: <AssetLibraryPage /> },
                    { path: "account", element: <AccountPage /> },
                    { path: "enterprise-assets", element: <EnterpriseAssetsPage /> },
                ],
            },
            {
                element: (
                    <AdminLayout>
                        <Outlet />
                    </AdminLayout>
                ),
                children: [
                    { path: "admin", element: <AdminDashboard /> },
                    { path: "admin/users", element: <AdminUsers /> },
                    { path: "admin/enterprises", element: <AdminEnterprises /> },
                    { path: "admin/credit-logs", element: <AdminCreditLogs /> },
                    { path: "admin/generation-tasks", element: <AdminGenerationTasks /> },
                    { path: "admin/canvas-nodes", element: <AdminCanvasNodes /> },
                    { path: "admin/prompts", element: <AdminPrompts /> },
                    { path: "admin/assets", element: <AdminAssets /> },
                    { path: "admin/settings", element: <AdminSettings /> },
                ],
            },
            { path: "*", element: <NotFound /> },
        ],
    },
]);
