import {
    CloudServerOutlined,
    ExperimentOutlined,
    FileTextOutlined,
    FolderOpenOutlined,
    HomeOutlined,
    LogoutOutlined,
    NodeIndexOutlined,
    PictureOutlined,
    SettingOutlined,
    TeamOutlined,
    ToolOutlined,
    TransactionOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography, theme } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { appPathname } from "@/i18n";
import { adminLayoutStyle } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { token: antToken } = theme.useToken();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const appPath = appPathname(pathname);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const logout = useUserStore((state) => state.clearSession);
    const adminMenus = [
        {
            key: "member-management",
            icon: <TeamOutlined />,
            label: t("admin.menus.memberManagement"),
            children: [
                { key: "/admin/enterprises", icon: <TeamOutlined />, label: t("admin.menus.enterprises") },
                { key: "/admin/users", icon: <UserOutlined />, label: t("admin.menus.users") },
            ],
        },
        {
            key: "content-management",
            icon: <FolderOpenOutlined />,
            label: t("admin.menus.contentManagement"),
            children: [
                { key: "/admin/prompts", icon: <FileTextOutlined />, label: t("admin.menus.prompts") },
                { key: "/admin/assets", icon: <PictureOutlined />, label: t("admin.menus.assets") },
                { key: "/admin/volcengine-assets", icon: <CloudServerOutlined />, label: t("admin.menus.volcengineAssets") },
            ],
        },
        {
            key: "operations-management",
            icon: <ToolOutlined />,
            label: t("admin.menus.operationsManagement"),
            children: [
                { key: "/admin/credit-logs", icon: <TransactionOutlined />, label: t("admin.menus.creditLogs") },
                { key: "/admin/generation-tasks", icon: <ExperimentOutlined />, label: t("admin.menus.generationTasks") },
                { key: "/admin/canvas-nodes", icon: <NodeIndexOutlined />, label: t("admin.menus.canvasNodes") },
                { key: "/admin/settings", icon: <SettingOutlined />, label: t("admin.menus.settings") },
            ],
        },
    ];
    const activeItem = adminMenus.flatMap((group) => group.children).find((item) => appPath.startsWith(item.key));
    const activeKey = activeItem?.key || "";
    const activeGroup = adminMenus.find((group) => group.children.some((item) => item.key === activeKey));
    const pageTitle = activeKey === "/admin/assets" ? t("admin.menus.assetsManagement") : activeItem?.label || t("admin.menus.users");

    useEffect(() => {
        if (!isReady) return;
        if (!token) {
            navigate("/login?redirect=/admin", { replace: true });
            return;
        }
        if (user?.role !== "admin") {
            navigate("/", { replace: true });
        }
    }, [isReady, token, user?.role, navigate]);

    if (!isReady || !token || user?.role !== "admin") {
        return (
            <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
                <span />
            </div>
        );
    }

    return (
        <Layout hasSider style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgLayout }}>
            <Layout.Sider width={adminLayoutStyle.siderWidth} style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgContainer, borderRight: `1px solid ${antToken.colorBorder}` }}>
                <Flex align="center" gap={12} style={{ height: adminLayoutStyle.brandHeight, padding: "0 20px", borderBottom: `1px solid ${antToken.colorBorderSecondary}` }}>
                    <BrandLogo variant="mark" height={28} />
                    <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0, color: antToken.colorText }}>
                        {t("common.brand")}
                    </Typography.Text>
                </Flex>
                <Menu
                    key={activeGroup?.key}
                    mode="inline"
                    selectedKeys={[activeKey]}
                    defaultOpenKeys={activeGroup ? [activeGroup.key] : []}
                    style={adminLayoutStyle.menu}
                    items={adminMenus.map((group) => ({
                        ...group,
                        children: group.children.map((item) => ({
                            ...item,
                            label: (
                                <Link to={item.key} style={{ color: "inherit" }}>
                                    {item.label}
                                </Link>
                            ),
                            style: adminLayoutStyle.menuItem,
                        })),
                    }))}
                />
                <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12, borderTop: `1px solid ${antToken.colorBorder}`, background: antToken.colorBgContainer }}>
                    <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">
                        {t("common.goToCanvas")}
                    </Button>
                    <Button block icon={<LogoutOutlined />} onClick={logout}>
                        {t("common.logout")}
                    </Button>
                </Flex>
            </Layout.Sider>
            <Layout style={{ background: antToken.colorBgLayout }}>
                <Layout.Header
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px", background: antToken.colorBgContainer, borderBottom: `1px solid ${antToken.colorBorder}` }}
                >
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        {pageTitle}
                    </Typography.Title>
                    <Flex align="center" gap={4}>
                        <UserStatusActions showConfig={false} />
                    </Flex>
                </Layout.Header>
                <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
            </Layout>
        </Layout>
    );
}
