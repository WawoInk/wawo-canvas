import { StoryboardStudio } from "./storyboard-studio";

export default function StoryboardPage() {
    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <StoryboardStudio />
            </main>
        </div>
    );
}
