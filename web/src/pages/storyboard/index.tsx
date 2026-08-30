import { Tabs } from "antd";

import { ScriptAgentStudio } from "./script-agent-studio";
import { StoryboardStudio } from "./storyboard-studio";

export default function StoryboardPage() {
    return (
        <div className="thin-scrollbar h-full overflow-y-auto bg-background text-foreground">
            <Tabs
                className="mx-auto min-h-full w-full max-w-[2400px] px-4 sm:px-6"
                defaultActiveKey="storyboard"
                destroyOnHidden={false}
                items={[
                    {
                        key: "storyboard",
                        label: "分镜创作室",
                        children: (
                            <main className="grid min-h-full grid-cols-1 gap-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
                                <StoryboardStudio />
                            </main>
                        ),
                    },
                    {
                        key: "script-agent",
                        label: "剧本 Agent",
                        forceRender: true,
                        children: (
                            <div className="min-h-full py-4">
                                <ScriptAgentStudio />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
