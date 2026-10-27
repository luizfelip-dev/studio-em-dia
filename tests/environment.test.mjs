import test from "node:test";
import assert from "node:assert/strict";
import { supabaseConnectSources } from "../src/lib/studio-environment.ts";
const testUrl = "https://qwcxjaldvehwgfnozaby.supabase.co";
const productionUrl = "https://bdrexwsbvydkfsnttcyu.supabase.co";
test("CSP de testes permite somente o banco separado", () => {
  assert.equal(supabaseConnectSources(testUrl, "test"), "'self' https://qwcxjaldvehwgfnozaby.supabase.co wss://qwcxjaldvehwgfnozaby.supabase.co");
});
test("build de testes recusa banco real", () => assert.throws(() => supabaseConnectSources(productionUrl, "test")));
test("build de testes sem configuração é bloqueado", () => assert.throws(() => supabaseConnectSources("", "test")));
test("CSP de produção usa apenas o banco configurado", () => assert.equal(supabaseConnectSources(productionUrl, "production"), "'self' https://bdrexwsbvydkfsnttcyu.supabase.co wss://bdrexwsbvydkfsnttcyu.supabase.co"));
test("build sem configuração não permite nenhum banco", () => assert.equal(supabaseConnectSources(), "'self'"));
test("CSP recusa origens extras ou conteúdo injetado", () => {
  for (const invalid of ["http://qwcxjaldvehwgfnozaby.supabase.co", testUrl + "/extra", testUrl + "?x=1", testUrl + "#hash", "https://evil.example", testUrl + "; https://evil.example", "https://user:pass@qwcxjaldvehwgfnozaby.supabase.co"]) {
    assert.throws(() => supabaseConnectSources(invalid, "test"));
  }
});
