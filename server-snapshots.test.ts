import { mkdtempSync, readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startInterviewServer } from "./server.ts";

const fetch: typeof globalThis.fetch = (input, init) => {
	const headers = new Headers(init?.headers);
	headers.set("Connection", "close");
	return globalThis.fetch(input, { ...init, headers });
};

const questions = {
	title: "Test Snapshots",
	questions: [{ id: "q1", type: "text" as const, question: "Name?" }],
};

async function startServer(snapshotDir: string, recoveryDir: string, vaultDir?: string) {
	return startInterviewServer(
		{
			questions,
			sessionToken: "test-token",
			sessionId: "01234567-9abc-4def-8123-456789abcdef",
			cwd: tmpdir(),
			timeout: 60,
			recoveryDir,
			snapshotDir,
			...(vaultDir !== undefined ? { vaultDir } : {}),
		},
		{
			onSubmit: async () => {},
			onCancel: async () => {},
		},
	);
}

const draftFolders = (dir: string) => readdirSync(dir).filter((f) => f.endsWith("-draft"));
const submittedFolders = (dir: string) => readdirSync(dir).filter((f) => f.endsWith("-submitted"));

it("overwrites a single stable draft folder across repeated autosaves", async ({ onTestFinished }) => {
	const snapshotDir = mkdtempSync(join(tmpdir(), "pi-interview-snaps-"));
	const recoveryDir = mkdtempSync(join(tmpdir(), "pi-interview-recovery-"));
	const handle = await startServer(snapshotDir, recoveryDir);
	onTestFinished(() => handle.close());

	const url = new URL("/save", handle.url);
	const body = JSON.stringify({ token: "test-token", responses: [{ id: "q1", value: "first" }] });

	const res1 = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
	expect(res1.status).toBe(200);
	const drafts1 = draftFolders(snapshotDir);
	expect(drafts1).toHaveLength(1);

	// Second autosave must overwrite the same folder, not create a new one
	const res2 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: "test-token", responses: [{ id: "q1", value: "second" }] }),
	});
	expect(res2.status).toBe(200);
	const drafts2 = draftFolders(snapshotDir);
	expect(drafts2).toEqual(drafts1);
	expect(readFileSync(join(snapshotDir, drafts2[0], "index.html"), "utf-8")).toContain("second");
});

it("removes the draft folder and recovery file when the interview is submitted", async ({ onTestFinished }) => {
	const snapshotDir = mkdtempSync(join(tmpdir(), "pi-interview-snaps-"));
	const recoveryDir = mkdtempSync(join(tmpdir(), "pi-interview-recovery-"));
	const handle = await startServer(snapshotDir, recoveryDir);
	onTestFinished(() => handle.close());

	// Autosave creates the draft
	await fetch(new URL("/save", handle.url), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: "test-token", responses: [{ id: "q1", value: "draft" }] }),
	});
	expect(draftFolders(snapshotDir)).toHaveLength(1);

	// Simulate a recovery file for this session (same sessionId short id)
	writeFileSync(join(recoveryDir, "2026-11-22_unknown_nogit_01234567.json"), "{}");
	expect(existsSync(join(recoveryDir, "2026-11-22_unknown_nogit_01234567.json"))).toBe(true);

	// Submit via /save with submitted: true
	const res = await fetch(new URL("/save", handle.url), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: "test-token",
			responses: [{ id: "q1", value: "final" }],
			submitted: true,
		}),
	});
	expect(res.status).toBe(200);

	expect(draftFolders(snapshotDir)).toEqual([]);
	expect(submittedFolders(snapshotDir)).toHaveLength(1);
	expect(readFileSync(join(snapshotDir, submittedFolders(snapshotDir)[0], "index.html"), "utf-8")).toContain("final");
	expect(existsSync(join(recoveryDir, "2026-11-22_unknown_nogit_01234567.json"))).toBe(false);
});

it("overwrites the recovery file for the same session instead of duplicating it", async ({ onTestFinished }) => {
	const { saveToRecovery } = await import("./server.ts");
	const recoveryDir = mkdtempSync(join(tmpdir(), "pi-interview-recovery-"));

	const p1 = saveToRecovery(questions, tmpdir(), "main", "01234567-9abc-4def-8123-456789abcdef", recoveryDir);
	const p2 = saveToRecovery(questions, tmpdir(), "main", "01234567-9abc-4def-8123-456789abcdef", recoveryDir);
	expect(p1).toBe(p2);
	expect(readdirSync(recoveryDir)).toEqual([p1.split("/").pop()]);
});

it("mirrors a submitted interview to the vault as Markdown + HTML", async ({ onTestFinished }) => {
	const snapshotDir = mkdtempSync(join(tmpdir(), "pi-interview-snaps-"));
	const recoveryDir = mkdtempSync(join(tmpdir(), "pi-interview-recovery-"));
	const vaultDir = mkdtempSync(join(tmpdir(), "pi-interview-vault-"));
	const handle = await startServer(snapshotDir, recoveryDir, vaultDir);
	onTestFinished(() => handle.close());

	const res = await fetch(new URL("/save", handle.url), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: "test-token",
			responses: [{ id: "q1", value: "Ada Lovelace" }],
			submitted: true,
		}),
	});
	expect(res.status).toBe(200);

	const notes = readdirSync(vaultDir).filter((f) => f.endsWith(".md"));
	expect(notes).toEqual([`Interview — Test Snapshots — ${new Date().toISOString().slice(0, 10)}.md`]);
	const note = readFileSync(join(vaultDir, notes[0]), "utf-8");
	expect(note).toContain("type: interview");
	expect(note).toContain("## Name?");
	expect(note).toContain("Ada Lovelace");

	// HTML snapshot copied under attachments/, linked from the note
	const attachmentDirs = readdirSync(join(vaultDir, "attachments"));
	expect(attachmentDirs).toHaveLength(1);
	expect(existsSync(join(vaultDir, "attachments", attachmentDirs[0], "index.html"))).toBe(true);
	expect(note).toContain(attachmentDirs[0]);
});

it("does not mirror to the vault on draft autosaves", async ({ onTestFinished }) => {
	const snapshotDir = mkdtempSync(join(tmpdir(), "pi-interview-snaps-"));
	const recoveryDir = mkdtempSync(join(tmpdir(), "pi-interview-recovery-"));
	const vaultDir = mkdtempSync(join(tmpdir(), "pi-interview-vault-"));
	const handle = await startServer(snapshotDir, recoveryDir, vaultDir);
	onTestFinished(() => handle.close());

	await fetch(new URL("/save", handle.url), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: "test-token", responses: [{ id: "q1", value: "draft" }] }),
	});

	expect(readdirSync(vaultDir)).toEqual([]);
});
