import { createBrowserRouter, Outlet } from "react-router-dom";

import { ClientRootInit } from "@/components/layout/client-root-init";

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
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminCreditLogs from "@/pages/admin/credit-logs";
import AdminGenerationTasks from "@/pages/admin/generation-tasks";
import AdminPrompts from "@/pages/admin/prompts";
import AdminAssets from "@/pages/admin/assets";
import AdminSettings from "@/pages/admin/settings";
import NotFound from "@/pages/not-found";

export const router = createBrowserRouter([
    {
        element: (
            <ClientRootInit>
                <Outlet />
            </ClientRootInit>
        ),
        children: [
            {
                element: (
                    <UserLayout>
                        <Outlet />
                    </UserLayout>
                ),
                children: [
                    { path: "/", element: <HomePage /> },
                    { path: "/login", element: <LoginPage /> },
                    { path: "/canvas", element: <CanvasListPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/image", element: <ImagePage /> },
                    { path: "/video", element: <VideoPage /> },
                    { path: "/prompts", element: <PromptsPage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/asset-library", element: <AssetLibraryPage /> },
                ],
            },
            {
                element: (
                    <AdminLayout>
                        <Outlet />
                    </AdminLayout>
                ),
                children: [
                    { path: "/admin", element: <AdminDashboard /> },
                    { path: "/admin/users", element: <AdminUsers /> },
                    { path: "/admin/credit-logs", element: <AdminCreditLogs /> },
                    { path: "/admin/generation-tasks", element: <AdminGenerationTasks /> },
                    { path: "/admin/prompts", element: <AdminPrompts /> },
                    { path: "/admin/assets", element: <AdminAssets /> },
                    { path: "/admin/settings", element: <AdminSettings /> },
                ],
            },
            { path: "*", element: <NotFound /> },
        ],
    },
]);
