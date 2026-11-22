import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startInterviewServer } from "./server.ts";
import { assertValidViewMode, loadSettings } from "./settings.ts";

const fetch: typeof globalThis.fetch = (input, init) => {
	const headers = new Headers(init?.headers);
	headers.set("Connection", "close");
	return globalThis.fetch(input, { ...init, headers });
};

const QUESTIONS = {
	title: "Stepper test",
	questions: [
		{ id: "q1", type: "text", question: "First?" },
		{ id: "q2", type: "text", question: "Second?" },
	],
} as const;

async function renderFormHtml(viewMode?: "stepper" | "list"): Promise<{ html: string; close: () => void }> {
	const server = await startInterviewServer(
		{
			questions: QUESTIONS as unknown as Parameters<typeof startInterviewServer>[0]["questions"],
			sessionToken: "stepper-token",
			sessionId: "stepper-session",
			cwd: process.cwd(),
			timeout: 600,
			...(viewMode !== undefined ? { viewMode } : {}),
		},
		{ onSubmit: () => {}, onCancel: () => {} },
	);
	try {
		const res = await fetch(`http://127.0.0.1:${server.port}/?session=stepper-token`);
		expect(res.status).toBe(200);
		const html = await res.text();
		return { html, close: () => server.close() };
	} catch (error) {
		server.close();
		throw error;
	}
}

describe("viewMode setting", () => {
	it("rejects unrecognized view modes loudly", () => {
		expect(() => assertValidViewMode("bogus")).toThrow(/viewMode/);
		expect(() => assertValidViewMode(undefined)).not.toThrow();
		expect(() => assertValidViewMode("stepper")).not.toThrow();
		expect(() => assertValidViewMode("list")).not.toThrow();
	});

	it("loads viewMode from settings.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-interview-"));
		const settingsPath = join(dir, "settings.json");

		writeFileSync(settingsPath, JSON.stringify({ interview: { viewMode: "list" } }));
		expect(loadSettings(settingsPath).viewMode).toBe("list");

		writeFileSync(settingsPath, JSON.stringify({ interview: { viewMode: "nope" } }));
		expect(() => loadSettings(settingsPath)).toThrow(/viewMode/);
	});
});

describe("stepper view mode", () => {
	it("defaults to stepper in the fork payload", async () => {
		const { html, close } = await renderFormHtml();
		try {
			expect(html).toContain('"viewMode":"stepper"');
		} finally {
			close();
		}
	});

	it("renders the stepper shell (sidebar, progress, footer nav)", async () => {
		const { html, close } = await renderFormHtml("stepper");
		try {
			expect(html).toContain('id="stepper-sidebar"');
			expect(html).toContain('id="stepper-sidebar-list"');
			expect(html).toContain('id="stepper-progress"');
			expect(html).toContain('id="stepper-prev-btn"');
			expect(html).toContain('id="stepper-next-btn"');
			expect(html).toContain('id="stepper-submit-btn"');
		} finally {
			close();
		}
	});

	it("list mode keeps the upstream layout (no visible stepper shell)", async () => {
		const { html, close } = await renderFormHtml("list");
		try {
			expect(html).toContain('"viewMode":"list"');
			// Shell exists in the template but stays hidden in list mode.
			expect(html).toContain('id="stepper-sidebar"');
			expect(html).toContain('class="stepper-sidebar hidden"');
		} finally {
			close();
		}
	});
});
