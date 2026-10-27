import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { readBackupFile } from "../src/lib/studio-backup.ts";
const fixture = JSON.parse(fs.readFileSync(new URL("./backup-fixture.json", import.meta.url), "utf8"));
async function fileFor(backup, editSheet) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("_DadosSistema", { state: "veryHidden" });
  workbook.addWorksheet("Resumo");
  sheet.addRow(["STUDIO_EM_DIA_BACKUP", 1, backup.exportedAt]);
  sheet.addRow(["tipo", "json"]);
  for (const [group, type] of [["clients", "client"], ["products", "product"], ["appointments", "appointment"], ["payments", "payment"], ["expenses", "expense"]]) {
    for (const value of backup[group]) sheet.addRow([type, JSON.stringify(value)]);
  }
  sheet.addRow(["settings", JSON.stringify(backup.settings)]);
  editSheet?.(sheet);
  return new File([await workbook.xlsx.writeBuffer()], "backup.xlsx");
}
test("Excel legado v1 mantém todos os dados e registros idênticos distintos", async () => {
  const parsed = await readBackupFile(await fileFor(fixture));
  assert.deepEqual(parsed, fixture);
  assert.equal(parsed.products.length, 2);
});
const invalid = [
  ["IDs duplicados", b => b.clients.push({...b.clients[0]})],
  ["cliente ausente", b => b.appointments[0].clientId = 999],
  ["produto ausente", b => b.appointments[0].productIds = [999]],
  ["produtos repetidos", b => b.appointments[0].productIds = [201, 201]],
  ["pagamento sem atendimento", b => b.payments[0].appointmentId = 999],
  ["pagamentos excessivos", b => b.payments[0].amountCents = 20000],
  ["centavos fracionários", b => b.payments[0].amountCents = 1.5],
  ["centavos acima do int32", b => b.appointments[0].amountCents = 2147483648],
  ["ID sem precisão", b => b.products[0].sourceId = Number.MAX_SAFE_INTEGER + 1],
  ["data impossível", b => b.appointments[0].serviceDate = "2026-02-30"],
  ["horário inválido", b => b.appointments[0].serviceTime = "25:00"],
  ["reserva excessiva", b => b.settings.reservePercent = 101],
  ["status inválido", b => b.appointments[0].status = "other"],
];
for (const [name, mutate] of invalid) test(name, async () => {
  const backup = structuredClone(fixture); mutate(backup);
  await assert.rejects(readBackupFile(await fileFor(backup)));
});
test("recusa configurações duplicadas", async () => {
  await assert.rejects(readBackupFile(await fileFor(fixture, s => s.addRow(["settings", JSON.stringify(fixture.settings)]))));
});
test("recusa linha técnica incompleta", async () => {
  await assert.rejects(readBackupFile(await fileFor(fixture, s => s.addRow(["client", ""]))));
});
test("recusa JSON corrompido", async () => {
  await assert.rejects(readBackupFile(await fileFor(fixture, s => s.addRow(["client", "{broken"]))));
});
test("recusa arquivo sem os metadados de restauração", async () => {
  await assert.rejects(readBackupFile(await fileFor(fixture, s => s.getCell("A1").value = "OTHER")));
});
