import assert from "node:assert/strict";
import { test } from "node:test";

import { validateScriptProjectConfig } from "./script-agent.ts";

test("project config is normalized and derives words per episode", () => {
    assert.deepEqual(
        validateScriptProjectConfig(
            {
                totalEpisodes: 24,
                episodeMinutes: 2,
                startChapter: 1,
                endChapter: 20,
                chapterIndexes: [3, 1, 3, 2],
                platform: "vertical_short_drama",
                aspectRatio: "9:16",
                style: "悬疑逆袭",
                paywall: "前8集免费，第9集起付费",
            },
            [1, 2, 3, 4, 5],
        ),
        {
            totalEpisodes: 24,
            episodeMinutes: 2,
            startChapter: 1,
            endChapter: 20,
            chapterIndexes: [1, 2, 3],
            platform: "vertical_short_drama",
            aspectRatio: "9:16",
            style: "悬疑逆袭",
            paywall: "前8集免费，第9集起付费",
            wordsPerEpisode: 300,
        },
    );
});

test("project config rejects incomplete, invalid and unavailable chapter data", () => {
    const valid = {
        totalEpisodes: 24,
        episodeMinutes: 2,
        startChapter: 1,
        endChapter: 20,
        chapterIndexes: [1, 2, 3],
        platform: "vertical_short_drama",
        aspectRatio: "9:16",
        style: "悬疑逆袭",
        paywall: "前8集免费，第9集起付费",
    };
    const code = (input, expected, available = [1, 2, 3]) =>
        assert.throws(() => validateScriptProjectConfig(input, available), (error) => error.code === expected);

    code({ ...valid, totalEpisodes: 0 }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, episodeMinutes: 1.5 }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, startChapter: 4, endChapter: 3 }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [0, 2] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [1, 4] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, style: " " }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, aspectRatio: "2:1" }, "PROJECT_CONFIG_INVALID");
});
