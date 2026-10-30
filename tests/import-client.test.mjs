import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/lib/studio-api.ts", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("./backup-fixture.json", import.meta.url), "utf8"));
let serial = 0;
async function importWith(result, user = { id: "fake-user" }) {
  const calls = [];
  globalThis.__studioImportTestClient = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (...args) => { calls.push(args); return result; },
    from: () => { throw new Error("Não pode usar gravações por etapas como fallback."); },
  };
  const injected = source.replace('import { supabase } from "./supabase";', "const supabase = globalThis.__studioImportTestClient;");
  const code = ts.transpileModule(injected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${serial++}`);
  delete globalThis.__studioImportTestClient;
  return { run: () => module.importStudioBackup(fixture), calls };
}
test("a importação usa uma única operação do banco", async () => {
  const client = await importWith({ data: { added: 8, kept: 0 }, error: null });
  assert.deepEqual(await client.run(), { added: 8, kept: 0 });
  assert.deepEqual(client.calls, [["import_studio_backup", { backup: fixture }]]);
});
test("falha de rede orienta repetir sem usar gravações parciais", async () => {
  const client = await importWith({ data: null, error: { message: "Failed to fetch", code: "" } });
  await assert.rejects(client.run(), /repita o mesmo arquivo/);
  assert.equal(client.calls.length, 1);
});
test("ambiente sem a migração falha de forma segura", async () => {
  const client = await importWith({ data: null, error: { code: "PGRST202", message: "missing function" } });
  await assert.rejects(client.run(), /Nenhum dado foi importado/);
});
test("resposta inválida não anuncia sucesso", async () => {
  const client = await importWith({ data: { added: -1, kept: 0 }, error: null });
  await assert.rejects(client.run(), /confirmar o resultado/);
});
test("sem login não envia a importação", async () => {
  const client = await importWith({ data: {}, error: null }, null);
  await assert.rejects(client.run(), /Entre novamente/);
  assert.equal(client.calls.length, 0);
});
