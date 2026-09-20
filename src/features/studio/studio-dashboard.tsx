"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, Banknote, Box, CalendarDays, CalendarPlus, ChevronLeft, Clock3,
  ChevronRight, CircleDollarSign, LayoutDashboard, Loader2, PackagePlus,
  Download, KeyRound, LogOut, MessageCircle, Pencil, Phone, PiggyBank, Plus, Printer, ReceiptText, Settings, Target, Upload,
  Trash2, UserPlus, Users, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { getStudioData, importStudioBackup, studioRequest, type StudioBackup } from "@/lib/studio-api";
import { supabase } from "@/lib/supabase";
import { StudioBrand } from "@/components/studio-brand";

type Product = { id: number; name: string; purchasePriceCents: number; totalAmount: number; unit: string; usePerService: number; costPerUseCents: number };
type Client = { id: number; name: string; phone: string; notes: string; createdAt: string };
type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled";
type PaymentKind = "deposit" | "partial" | "final" | "full";
type Payment = { id: number; amountCents: number; kind: PaymentKind; paidAt: string; note: string };
type Appointment = { id: number; clientId: number | null; clientName: string; service: string; serviceDate: string; serviceTime: string; status: AppointmentStatus; amountCents: number; productIds: number[]; productCostCents: number; extraCostCents: number; paymentFeeCents: number; totalCostCents: number; profitCents: number; paidCents: number; pendingCents: number; payments: Payment[] };
type Expense = { id: number; description: string; category: string; expenseDate: string; amountCents: number };
type StudioSettings = { monthlyGoalCents: number; reservePercent: number };
type StudioData = { clients: Client[]; products: Product[]; appointments: Appointment[]; expenses: Expense[]; settings: StudioSettings };
type DeleteTarget = { type: "appointments" | "clients" | "expenses" | "products"; id: number; name: string } | null;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const SERVICES = ["Maquiagem express", "Maquiagem social", "Penteado simples"] as const;
const APPOINTMENT_STATUS: Record<AppointmentStatus, string> = { scheduled: "Agendado", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado" };
const PAYMENT_KIND: Record<PaymentKind, string> = { deposit: "Sinal", partial: "Pagamento parcial", final: "Pagamento final", full: "Pagamento integral" };
const BACKUP_MARKER = "STUDIO_EM_DIA_BACKUP";
const BACKUP_VERSION = 1;
const BACKUP_SYSTEM_SHEET = "_DadosSistema";

function cents(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
function money(value: number) { return brl.format(value / 100); }
function todayInput() { const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 10); }
function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function parseDate(value: string) { return new Date(`${value}T12:00:00`); }
function appointmentDateTime(appointment: Appointment) { return new Date(`${appointment.serviceDate}T${appointment.serviceTime || "23:59"}:00`); }
function upcomingLabel(appointment: Appointment) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const date = parseDate(appointment.serviceDate);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return "Hoje";
  if (days === 1) return "Amanhã";
  return `Em ${days} dias`;
}

function calendarDateTime(date: string, time: string, addMinutes = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(year, month - 1, day, hour, minute + addMinutes, 0);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}${part(value.getMonth() + 1)}${part(value.getDate())}T${part(value.getHours())}${part(value.getMinutes())}00`;
}

function calendarUtcStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeCalendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function appointmentDuration(service: string) {
  return service.split(" + ").reduce((minutes, item) => minutes + (item === "Maquiagem social" ? 120 : 60), 0) || 60;
}

function downloadCalendarEvent(appointment: Appointment, client?: Client) {
  if (!appointment.serviceTime) { toast.error("Informe o horário antes de adicionar à agenda."); return; }
  const description = [
    `Serviços: ${appointment.service}`,
    `Valor: ${money(appointment.amountCents)}`,
    `Recebido: ${money(appointment.paidCents)}`,
    `Pendente: ${money(appointment.pendingCents)}`,
    client?.phone ? `Telefone: ${client.phone}` : "",
    client?.notes ? `Observações: ${client.notes}` : "",
  ].filter(Boolean).join("\n");
  const content = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Studio em Dia//Agenda V2//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:appointment-${appointment.id}@studio-em-dia`, `DTSTAMP:${calendarUtcStamp()}`,
    `DTSTART:${calendarDateTime(appointment.serviceDate, appointment.serviceTime)}`,
    `DTEND:${calendarDateTime(appointment.serviceDate, appointment.serviceTime, appointmentDuration(appointment.service))}`,
    `SUMMARY:${escapeCalendarText(`${appointment.service} - ${appointment.clientName}`)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Atendimento amanhã", "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Atendimento em 2 horas", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atendimento-${appointment.clientName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success("Evento pronto para adicionar à agenda.");
}

function whatsappPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return "";
}

function openWhatsAppConfirmation(appointment: Appointment, client?: Client) {
  const phone = whatsappPhone(client?.phone ?? "");
  if (!phone) { toast.error("Cadastre um telefone válido para esta cliente."); return; }
  const date = appointment.serviceDate.split("-").reverse().join("/");
  const message = [
    `Olá, ${appointment.clientName}! Tudo bem?`,
    "",
    `Passando para confirmar seu atendimento de ${appointment.service}, no dia ${date}, às ${appointment.serviceTime}.`,
    `Valor combinado: ${money(appointment.amountCents)}.`,
    "",
    "Você pode me confirmar, por favor? 💄✨",
  ].join("\n");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field-group"><Label htmlFor={id}>{label}</Label>{children}{hint ? <span className="field-hint">{hint}</span> : null}</div>;
}

async function requestJson(url: string, init?: RequestInit) {
  return studioRequest(url, init);
}

function excelDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date;
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function backupObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Dados inválidos em ${label}.`);
  return value as Record<string, unknown>;
}

function backupString(value: unknown, label: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`Campo inválido em ${label}.`);
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maxLength) throw new Error(`Campo inválido em ${label}.`);
  return text;
}

function backupNumber(value: unknown, label: string, { integer = false, min = 0 }: { integer?: boolean; min?: number } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) throw new Error(`Número inválido em ${label}.`);
  return value;
}

function backupId(value: unknown, label: string) {
  return backupNumber(value, label, { integer: true, min: 1 });
}

function backupDate(value: unknown, label: string) {
  const date = backupString(value, label, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`Data inválida em ${label}.`);
  return date;
}

function backupTime(value: unknown, label: string) {
  const time = backupString(value, label, 5, true);
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Horário inválido em ${label}.`);
  return time;
}

function assertUniqueSourceIds(records: Array<{ sourceId: number }>, label: string) {
  if (new Set(records.map((item) => item.sourceId)).size !== records.length) throw new Error(`O backup possui ${label} repetidos.`);
}

function validateBackupRecord(type: string, value: unknown) {
  const item = backupObject(value, type);
  if (type === "client") {
    const phone = backupString(item.phone, "telefone", 30, true);
    const createdAt = backupString(item.createdAt, "data de cadastro", 40);
    if (phone && phone.length < 8) throw new Error("Telefone inválido no backup.");
    if (Number.isNaN(new Date(createdAt).getTime())) throw new Error("Data de cadastro inválida no backup.");
    return {
      sourceId: backupId(item.sourceId, "cliente"),
      name: backupString(item.name, "cliente", 120),
      phone,
      notes: backupString(item.notes, "observações", 1000, true),
      createdAt,
    };
  }
  if (type === "product") {
    const unit = backupString(item.unit, "unidade", 3);
    if (!["ml", "g", "un."].includes(unit)) throw new Error("Unidade de produto inválida no backup.");
    return {
      sourceId: backupId(item.sourceId, "produto"),
      name: backupString(item.name, "produto", 120),
      purchasePriceCents: backupNumber(item.purchasePriceCents, "preço do produto", { integer: true, min: 1 }),
      totalAmount: backupNumber(item.totalAmount, "quantidade do produto", { min: Number.EPSILON }),
      unit,
      usePerService: backupNumber(item.usePerService, "uso do produto", { min: Number.EPSILON }),
    };
  }
  if (type === "appointment") {
    const status = backupString(item.status, "status", 20) as AppointmentStatus;
    if (!Object.hasOwn(APPOINTMENT_STATUS, status)) throw new Error("Status de atendimento inválido no backup.");
    const clientId = item.clientId === null ? null : backupId(item.clientId, "cliente do atendimento");
    const rawProductIds = item.productIds ?? [];
    if (!Array.isArray(rawProductIds) || rawProductIds.length > 500) throw new Error("Lista de produtos inválida no backup.");
    const productIds = rawProductIds.map((id) => backupId(id, "produto do atendimento"));
    if (new Set(productIds).size !== productIds.length) throw new Error("O backup possui produtos repetidos em um atendimento.");
    return {
      sourceId: backupId(item.sourceId, "atendimento"), clientId,
      clientName: backupString(item.clientName, "cliente do atendimento", 120),
      service: backupString(item.service, "serviço", 240),
      serviceDate: backupDate(item.serviceDate, "atendimento"),
      serviceTime: backupTime(item.serviceTime, "atendimento"), status,
      amountCents: backupNumber(item.amountCents, "valor do atendimento", { integer: true, min: 1 }),
      productIds,
      productCostCents: backupNumber(item.productCostCents, "custo de produtos", { integer: true }),
      extraCostCents: backupNumber(item.extraCostCents, "custo extra", { integer: true }),
      paymentFeeCents: backupNumber(item.paymentFeeCents, "taxa de pagamento", { integer: true }),
    };
  }
  if (type === "payment") {
    const kind = backupString(item.kind, "tipo de pagamento", 20) as PaymentKind;
    if (!Object.hasOwn(PAYMENT_KIND, kind)) throw new Error("Tipo de pagamento inválido no backup.");
    return {
      sourceId: backupId(item.sourceId, "pagamento"),
      appointmentId: backupId(item.appointmentId, "atendimento do pagamento"),
      amountCents: backupNumber(item.amountCents, "valor do pagamento", { integer: true, min: 1 }),
      kind, paidAt: backupDate(item.paidAt, "pagamento"),
      note: backupString(item.note, "observação do pagamento", 300, true),
    };
  }
  if (type === "expense") return {
    sourceId: backupId(item.sourceId, "gasto"),
    description: backupString(item.description, "descrição do gasto", 160),
    category: backupString(item.category, "categoria do gasto", 80),
    expenseDate: backupDate(item.expenseDate, "gasto"),
    amountCents: backupNumber(item.amountCents, "valor do gasto", { integer: true, min: 1 }),
  };
  if (type === "settings") return {
    monthlyGoalCents: backupNumber(item.monthlyGoalCents, "meta mensal", { integer: true, min: 1 }),
    reservePercent: backupNumber(item.reservePercent, "percentual de reserva"),
  };
  throw new Error("O arquivo contém um tipo de registro desconhecido.");
}

async function readBackupFile(file: File): Promise<StudioBackup> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Escolha um arquivo Excel .xlsx exportado pelo Studio em Dia.");
  if (file.size > 20 * 1024 * 1024) throw new Error("O arquivo é grande demais para ser um backup válido.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(BACKUP_SYSTEM_SHEET);
  if (!sheet || sheet.getCell("A1").text !== BACKUP_MARKER || Number(sheet.getCell("B1").value) !== BACKUP_VERSION) {
    throw new Error("Este Excel não possui os dados técnicos de restauração. Exporte um novo backup pelo Studio em Dia e tente novamente.");
  }
  const backup: StudioBackup = {
    format: "studio-em-dia", version: 1, exportedAt: sheet.getCell("C1").text,
    clients: [], products: [], appointments: [], payments: [], expenses: [],
    settings: { monthlyGoalCents: 0, reservePercent: 0 },
  };
  let settingsFound = false;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const type = row.getCell(1).text;
    const json = row.getCell(2).text;
    if (!type || !json) return;
    let decoded: unknown;
    try { decoded = JSON.parse(json); } catch { throw new Error("O backup contém uma linha danificada."); }
    const record = validateBackupRecord(type, decoded);
    if (type === "client") backup.clients.push(record as StudioBackup["clients"][number]);
    else if (type === "product") backup.products.push(record as StudioBackup["products"][number]);
    else if (type === "appointment") backup.appointments.push(record as StudioBackup["appointments"][number]);
    else if (type === "payment") backup.payments.push(record as StudioBackup["payments"][number]);
    else if (type === "expense") backup.expenses.push(record as StudioBackup["expenses"][number]);
    else if (type === "settings") { backup.settings = record as StudioBackup["settings"]; settingsFound = true; }
  });
  if (!settingsFound) throw new Error("O backup não contém as configurações necessárias.");
  const totalRecords = backup.clients.length + backup.products.length + backup.appointments.length + backup.payments.length + backup.expenses.length;
  if (totalRecords > 20_000) throw new Error("O backup ultrapassa o limite seguro de registros.");
  assertUniqueSourceIds(backup.clients, "clientes");
  assertUniqueSourceIds(backup.products, "produtos");
  assertUniqueSourceIds(backup.appointments, "atendimentos");
  assertUniqueSourceIds(backup.payments, "pagamentos");
  assertUniqueSourceIds(backup.expenses, "gastos");
  const clientIds = new Set(backup.clients.map((item) => item.sourceId));
  const productIds = new Set(backup.products.map((item) => item.sourceId));
  const appointmentIds = new Set(backup.appointments.map((item) => item.sourceId));
  if (backup.appointments.some((item) => item.clientId !== null && !clientIds.has(item.clientId))) throw new Error("O backup contém um atendimento sem cliente correspondente.");
  if (backup.appointments.some((item) => item.productIds.some((id) => !productIds.has(id)))) throw new Error("O backup contém um atendimento com produto desconhecido.");
  if (backup.payments.some((item) => !appointmentIds.has(item.appointmentId))) throw new Error("O backup contém um pagamento sem atendimento correspondente.");
  const paidByAppointment = new Map<number, number>();
  backup.payments.forEach((payment) => paidByAppointment.set(payment.appointmentId, (paidByAppointment.get(payment.appointmentId) ?? 0) + payment.amountCents));
  if (backup.appointments.some((appointment) => (paidByAppointment.get(appointment.sourceId) ?? 0) > appointment.amountCents)) throw new Error("O backup contém pagamentos acima do valor de um atendimento.");
  if (backup.settings.reservePercent > 100) throw new Error("O percentual de reserva do backup é inválido.");
  return backup;
}

async function downloadBackup(data: StudioData) {
  const toastId = toast.loading("Preparando o backup em Excel...");
  try {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Studio em Dia";
    workbook.created = new Date();
    workbook.modified = new Date();

    const brand = "FF8F2752";
    const brandLight = "FFF8EAF0";
    const border = "FFE4DDE1";
    const text = "FF302C32";
    const currencyFormat = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

    const addDataSheet = (
      name: string,
      description: string,
      headers: string[],
      rows: Array<Array<string | number | Date>>,
      widths: number[],
      dateColumns: number[] = [],
      currencyColumns: number[] = [],
    ) => {
      const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
      sheet.getCell("A1").value = name;
      sheet.getCell("A1").font = { name: "Arial", size: 15, bold: true, color: { argb: brand } };
      sheet.getCell("A2").value = description;
      sheet.getCell("A2").font = { name: "Arial", size: 10, italic: true, color: { argb: "FF777079" } };
      sheet.getRow(4).values = headers;
      sheet.getRow(4).height = 25;
      sheet.getRow(4).eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      rows.forEach((values) => {
        const row = sheet.addRow(values);
        row.height = 22;
        row.eachCell((cell) => {
          cell.font = { name: "Arial", size: 10, color: { argb: text } };
          cell.alignment = { vertical: "middle" };
          cell.border = { bottom: { style: "thin", color: { argb: border } } };
        });
      });
      widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      dateColumns.forEach((column) => { sheet.getColumn(column).numFmt = "dd/mm/yyyy"; });
      currencyColumns.forEach((column) => { sheet.getColumn(column).numFmt = currencyFormat; });
      if (rows.length) sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
      sheet.pageSetup = { orientation: headers.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
      return sheet;
    };

    const activeAppointments = data.appointments.filter((item) => item.status !== "cancelled");
    const revenue = activeAppointments.reduce((sum, item) => sum + item.amountCents, 0) / 100;
    const received = data.appointments.reduce((sum, item) => sum + item.paidCents, 0) / 100;
    const pending = activeAppointments.reduce((sum, item) => sum + item.pendingCents, 0) / 100;
    const serviceCosts = activeAppointments.reduce((sum, item) => sum + item.totalCostCents, 0) / 100;
    const expenses = data.expenses.reduce((sum, item) => sum + item.amountCents, 0) / 100;

    const summary = addDataSheet("Resumo", "Visão geral de todos os registros incluídos neste backup.", ["Indicador", "Valor"], [
      ["Data do backup", excelDate(todayInput())],
      ["Clientes cadastradas", data.clients.length],
      ["Atendimentos cadastrados", data.appointments.length],
      ["Receita prevista", revenue],
      ["Valor recebido", received],
      ["Valor pendente", pending],
      ["Custos dos atendimentos", serviceCosts],
      ["Gastos registrados", expenses],
      ["Lucro estimado", revenue - serviceCosts - expenses],
      ["Meta mensal", data.settings.monthlyGoalCents / 100],
      ["Percentual de reserva", data.settings.reservePercent / 100],
    ], [30, 22]);
    summary.getCell("B5").numFmt = "dd/mm/yyyy";
    for (let rowNumber = 8; rowNumber <= 14; rowNumber += 1) summary.getCell(rowNumber, 2).numFmt = currencyFormat;
    summary.getCell("B15").numFmt = "0%";
    for (let rowNumber = 5; rowNumber <= 15; rowNumber += 1) {
      if (rowNumber % 2 === 0) summary.getRow(rowNumber).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brandLight } }; });
    }

    addDataSheet("Clientes", "Cadastro e informações de contato.", ["Nome", "Telefone", "Observações", "Cadastro"], data.clients.map((item) => [item.name, item.phone, item.notes, excelDate(item.createdAt)]), [28, 20, 48, 15], [4]);
    addDataSheet("Atendimentos", "Agenda, situação financeira e custos de cada atendimento.", ["Data", "Horário", "Status", "Cliente", "Serviços", "Valor", "Recebido", "Pendente", "Custo", "Lucro"], data.appointments.map((item) => [excelDate(item.serviceDate), item.serviceTime, APPOINTMENT_STATUS[item.status], item.clientName, item.service, item.amountCents / 100, item.paidCents / 100, item.pendingCents / 100, item.totalCostCents / 100, item.profitCents / 100]), [14, 12, 14, 26, 34, 16, 16, 16, 16, 16], [1], [6, 7, 8, 9, 10]);
    addDataSheet("Pagamentos", "Sinais, pagamentos parciais e quitações.", ["Data", "Cliente", "Tipo", "Valor", "Observação"], data.appointments.flatMap((item) => item.payments.map((payment) => [excelDate(payment.paidAt), item.clientName, PAYMENT_KIND[payment.kind], payment.amountCents / 100, payment.note])), [14, 26, 22, 16, 40], [1], [4]);
    addDataSheet("Gastos", "Despesas registradas no Studio em Dia.", ["Data", "Descrição", "Categoria", "Valor"], data.expenses.map((item) => [excelDate(item.expenseDate), item.description, item.category, item.amountCents / 100]), [14, 34, 22, 16], [1], [4]);
    addDataSheet("Produtos", "Produtos cadastrados e custo estimado por uso.", ["Produto", "Preço de compra", "Quantidade", "Unidade", "Uso médio", "Custo por uso"], data.products.map((item) => [item.name, item.purchasePriceCents / 100, item.totalAmount, item.unit, item.usePerService, item.costPerUseCents / 100]), [30, 18, 16, 14, 16, 18], [], [2, 6]);
    addDataSheet("Configurações", "Configurações financeiras salvas no sistema.", ["Configuração", "Valor"], [["Meta mensal", data.settings.monthlyGoalCents / 100], ["Percentual de reserva", data.settings.reservePercent / 100]], [30, 20]);
    workbook.getWorksheet("Configurações")!.getCell("B5").numFmt = currencyFormat;
    workbook.getWorksheet("Configurações")!.getCell("B6").numFmt = "0%";

    const systemSheet = workbook.addWorksheet(BACKUP_SYSTEM_SHEET);
    systemSheet.state = "veryHidden";
    systemSheet.addRow([BACKUP_MARKER, BACKUP_VERSION, new Date().toISOString()]);
    systemSheet.addRow(["Tipo", "Dados"]);
    data.clients.forEach((item) => systemSheet.addRow(["client", JSON.stringify({ sourceId: item.id, name: item.name, phone: item.phone, notes: item.notes, createdAt: item.createdAt })]));
    data.products.forEach((item) => systemSheet.addRow(["product", JSON.stringify({ sourceId: item.id, name: item.name, purchasePriceCents: item.purchasePriceCents, totalAmount: item.totalAmount, unit: item.unit, usePerService: item.usePerService })]));
    data.appointments.forEach((item) => {
      systemSheet.addRow(["appointment", JSON.stringify({
        sourceId: item.id, clientId: item.clientId, clientName: item.clientName, service: item.service,
        serviceDate: item.serviceDate, serviceTime: item.serviceTime, status: item.status,
        amountCents: item.amountCents, productIds: item.productIds, productCostCents: item.productCostCents,
        extraCostCents: item.extraCostCents, paymentFeeCents: item.paymentFeeCents,
      })]);
      item.payments.forEach((payment) => systemSheet.addRow(["payment", JSON.stringify({ sourceId: payment.id, appointmentId: item.id, amountCents: payment.amountCents, kind: payment.kind, paidAt: payment.paidAt, note: payment.note })]));
    });
    data.expenses.forEach((item) => systemSheet.addRow(["expense", JSON.stringify({ sourceId: item.id, description: item.description, category: item.category, expenseDate: item.expenseDate, amountCents: item.amountCents })]));
    systemSheet.addRow(["settings", JSON.stringify(data.settings)]);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studio-em-dia-backup-${todayInput()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Backup em Excel baixado com sucesso.", { id: toastId });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Não foi possível gerar o backup em Excel.", { id: toastId });
  }
}

export function StudioDashboard({ userEmail, onSignOut, testEnvironment = false }: { userEmail: string; onSignOut: () => void; testEnvironment?: boolean }) {
  const [data, setData] = useState<StudioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("inicio");
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [paymentAppointment, setPaymentAppointment] = useState<Appointment | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [saving, setSaving] = useState(false);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<number | null>(null);

  const loadData = async () => {
    setLoadError("");
    try {
      setData(await getStudioData());
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Não foi possível carregar seus dados."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void loadData();
    const refresh = () => void loadData();
    window.addEventListener("studio-data-changed", refresh);
    return () => window.removeEventListener("studio-data-changed", refresh);
  }, []);

  const monthAppointments = useMemo(() => data?.appointments.filter((item) => item.serviceDate.startsWith(selectedMonth)) ?? [], [data, selectedMonth]);
  const monthExpenses = useMemo(() => data?.expenses.filter((item) => item.expenseDate.startsWith(selectedMonth)) ?? [], [data, selectedMonth]);
  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    const limit = new Date(now.getTime() + 7 * 86_400_000);
    return (data?.appointments ?? []).filter((item) => (item.status === "scheduled" || item.status === "confirmed") && appointmentDateTime(item) >= now && appointmentDateTime(item) <= limit).sort((first, second) => appointmentDateTime(first).getTime() - appointmentDateTime(second).getTime());
  }, [data]);
  const totals = useMemo(() => {
    const activeAppointments = monthAppointments.filter((item) => item.status !== "cancelled");
    const revenue = activeAppointments.reduce((sum, item) => sum + item.amountCents, 0);
    const received = monthAppointments.reduce((sum, item) => sum + item.paidCents, 0);
    const pending = activeAppointments.reduce((sum, item) => sum + item.pendingCents, 0);
    const serviceCosts = activeAppointments.reduce((sum, item) => sum + item.totalCostCents, 0);
    const expenses = monthExpenses.reduce((sum, item) => sum + item.amountCents, 0);
    const profit = revenue - serviceCosts - expenses;
    const reserve = Math.max(0, Math.round(received * ((data?.settings.reservePercent ?? 10) / 100)));
    return { revenue, received, pending, serviceCosts, expenses, profit, reserve, available: received - serviceCosts - expenses - reserve };
  }, [monthAppointments, monthExpenses, data?.settings.reservePercent]);
  const selectedMonthDate = useMemo(() => { const [year, month] = selectedMonth.split("-").map(Number); return new Date(year, month - 1, 1); }, [selectedMonth]);
  const moveMonth = (difference: number) => { const next = new Date(selectedMonthDate); next.setMonth(next.getMonth() + difference); setSelectedMonth(monthKey(next)); };
  const goal = data?.settings.monthlyGoalCents ?? 500000;
  const goalPercent = goal > 0 ? Math.min(100, Math.round((totals.received / goal) * 100)) : 0;
  const goalRemaining = Math.max(0, goal - totals.received);

  const printMonthlyReport = () => {
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { toast.error("Permita a abertura de uma nova aba para gerar o relatório."); return; }
    reportWindow.opener = null;
    const reportMonth = monthName.format(selectedMonthDate);
    const appointmentsRows = monthAppointments.map((item) => `<tr><td>${escapeHtml(new Intl.DateTimeFormat("pt-BR").format(parseDate(item.serviceDate)))}</td><td>${escapeHtml(item.serviceTime || "—")}</td><td>${escapeHtml(item.clientName)}</td><td>${escapeHtml(item.service)}</td><td><span class="status status-${item.status}">${escapeHtml(APPOINTMENT_STATUS[item.status])}</span></td><td>${escapeHtml(money(item.amountCents))}</td><td>${escapeHtml(money(item.paidCents))}</td><td>${escapeHtml(money(item.pendingCents))}</td></tr>`).join("");
    const expensesRows = monthExpenses.map((item) => `<tr><td>${escapeHtml(new Intl.DateTimeFormat("pt-BR").format(parseDate(item.expenseDate)))}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(money(item.amountCents))}</td></tr>`).join("");
    reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório - ${escapeHtml(reportMonth)}</title><style>
      :root{font-family:Arial,sans-serif;color:#302c32}*{box-sizing:border-box}body{max-width:1120px;margin:0 auto;padding:32px;background:#fff}.actions{display:flex;justify-content:flex-end;margin-bottom:20px}.actions button{border:0;border-radius:10px;padding:11px 16px;color:#fff;background:#8f2752;font-weight:700;cursor:pointer}header{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #8f2752;padding-bottom:14px}h1{margin:0;color:#8f2752;font-size:25px}header p{margin:5px 0 0;color:#6f6870;text-transform:capitalize}.generated{font-size:12px;color:#777079}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.card{border:1px solid #e4dde1;border-radius:12px;padding:13px;background:#faf8f9}.card span{display:block;color:#777079;font-size:11px}.card strong{display:block;margin-top:5px;font-size:17px}.section{margin-top:26px}h2{margin:0 0 10px;font-size:16px}table{width:100%;border-collapse:collapse;font-size:11px}th{padding:9px 7px;text-align:left;color:#fff;background:#8f2752}td{border-bottom:1px solid #e8e3e6;padding:8px 7px;vertical-align:top}th:nth-last-child(-n+3),td:nth-last-child(-n+3){text-align:right}.expenses th:last-child,.expenses td:last-child{text-align:right}.status{font-weight:700}.status-confirmed{color:#326ca7}.status-completed{color:#287b5a}.status-cancelled{color:#a3303b}.empty{border:1px solid #e4dde1;border-radius:10px;padding:14px;color:#777079;font-size:12px}.note{margin-top:22px;color:#777079;font-size:10px}@media(max-width:700px){body{padding:18px}.summary{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start;flex-direction:column;gap:8px}.table-wrap{overflow-x:auto}table{min-width:850px}}@media print{@page{size:A4 landscape;margin:10mm}body{max-width:none;padding:0}.actions{display:none}.summary{break-inside:avoid}.section{break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}.note{margin-top:14px}}
    </style></head><body><div class="actions"><button type="button" onclick="window.print()">Imprimir ou salvar em PDF</button></div><header><div><h1>Studio em Dia</h1><p>Relatório mensal · ${escapeHtml(reportMonth)}</p></div><span class="generated">Gerado em ${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date()))}</span></header><section class="summary"><div class="card"><span>Recebido</span><strong>${escapeHtml(money(totals.received))}</strong></div><div class="card"><span>A receber</span><strong>${escapeHtml(money(totals.pending))}</strong></div><div class="card"><span>Receita prevista</span><strong>${escapeHtml(money(totals.revenue))}</strong></div><div class="card"><span>Lucro previsto</span><strong>${escapeHtml(money(totals.profit))}</strong></div><div class="card"><span>Custos e gastos</span><strong>${escapeHtml(money(totals.serviceCosts + totals.expenses))}</strong></div><div class="card"><span>Reserva</span><strong>${escapeHtml(money(totals.reserve))}</strong></div><div class="card"><span>Saldo disponível</span><strong>${escapeHtml(money(totals.available))}</strong></div><div class="card"><span>Atendimentos</span><strong>${monthAppointments.length}</strong></div></section><section class="section"><h2>Atendimentos</h2>${appointmentsRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Horário</th><th>Cliente</th><th>Serviços</th><th>Status</th><th>Valor</th><th>Recebido</th><th>Pendente</th></tr></thead><tbody>${appointmentsRows}</tbody></table></div>` : '<p class="empty">Nenhum atendimento registrado neste mês.</p>'}</section><section class="section"><h2>Gastos</h2>${expensesRows ? `<div class="table-wrap"><table class="expenses"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>${expensesRows}</tbody></table></div>` : '<p class="empty">Nenhum gasto registrado neste mês.</p>'}</section><p class="note">Atendimentos cancelados aparecem na lista, mas não entram na receita prevista, nos custos ou no lucro.</p></body></html>`);
    reportWindow.document.close();
    reportWindow.focus();
    window.setTimeout(() => reportWindow.print(), 350);
  };

  const deleteItem = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try { await requestJson(`/api/${deleteTarget.type}?id=${deleteTarget.id}`, { method: "DELETE" }); toast.success("Registro excluído."); setDeleteTarget(null); await loadData(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível excluir."); }
    finally { setSaving(false); }
  };

  const updateAppointmentStatus = async (id: number, status: AppointmentStatus) => {
    setUpdatingAppointmentId(id);
    try { await requestJson("/api/appointments", { method: "PUT", body: JSON.stringify({ id, status }) }); toast.success(`Atendimento marcado como ${APPOINTMENT_STATUS[status].toLowerCase()}.`); await loadData(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o status."); }
    finally { setUpdatingAppointmentId(null); }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="app-shell">
      <aside className="sidebar">
        <div className="brand-block"><StudioBrand inverted compact /></div>
        <TabsList className="main-nav" aria-label="Navegação principal">
          <TabsTrigger value="inicio"><LayoutDashboard /><span>Início</span></TabsTrigger>
          <TabsTrigger value="clientes"><Users /><span>Clientes</span></TabsTrigger>
          <TabsTrigger value="atendimentos"><CalendarDays /><span>Atendimentos</span></TabsTrigger>
          <TabsTrigger value="gastos"><ReceiptText /><span>Gastos</span></TabsTrigger>
          <TabsTrigger value="produtos"><Box /><span>Produtos</span></TabsTrigger>
        </TabsList>
        <div className="sidebar-actions"><button className="settings-link" type="button" onClick={() => setSettingsOpen(true)}><Settings aria-hidden="true" /><span>Meta e reserva</span></button><button className="logout-link" type="button" onClick={onSignOut} title={userEmail}><LogOut aria-hidden="true" /><span>Sair</span></button></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title"><div className="mobile-brand"><StudioBrand compact /></div>{testEnvironment ? <span className="test-badge test-badge--topbar">V2 · Testes</span> : null}<p className="eyebrow">Visão do mês</p><h1>{monthName.format(selectedMonthDate)}</h1></div>
          <div className="topbar-actions">
            <div className="month-switcher" aria-label="Escolher mês"><button type="button" onClick={() => moveMonth(-1)} aria-label="Mês anterior"><ChevronLeft /></button><button type="button" onClick={() => setSelectedMonth(monthKey())}>Hoje</button><button type="button" onClick={() => moveMonth(1)} aria-label="Próximo mês"><ChevronRight /></button></div>
            <Button className="report-action" variant="outline" onClick={printMonthlyReport}><Printer /> Relatório</Button><Button className="primary-action" onClick={() => setAppointmentOpen(true)}><Plus /> Novo atendimento</Button><button className="topbar-logout" type="button" onClick={onSignOut} aria-label="Sair da conta"><LogOut /></button>
          </div>
        </header>

        {loadError ? <section className="error-state" role="alert"><strong>Não conseguimos abrir seus dados.</strong><p>{loadError}</p><Button variant="outline" onClick={() => { setLoading(true); void loadData(); }}>Tentar novamente</Button></section>
        : loading ? <LoadingView /> : <>
          <TabsContent value="inicio" className="page-content">
            <section className="summary-grid" aria-label="Resumo financeiro">
              <article className="summary-card summary-card--hero"><div className="summary-icon"><CircleDollarSign /></div><p>Recebido</p><strong>{money(totals.received)}</strong><span>sinais e pagamentos registrados</span></article>
              <article className="summary-card"><div className="summary-icon summary-icon--blue"><WalletCards /></div><p>A receber</p><strong>{money(totals.pending)}</strong><span>saldo pendente dos atendimentos ativos</span></article>
              <article className="summary-card"><div className="summary-icon summary-icon--green"><ArrowUpRight /></div><p>Lucro previsto</p><strong>{money(totals.profit)}</strong><span>com base nos atendimentos ativos</span></article>
              <article className="summary-card"><div className="summary-icon summary-icon--orange"><ArrowDownRight /></div><p>Gastos totais</p><strong>{money(totals.serviceCosts + totals.expenses)}</strong><span>produtos, taxas e despesas</span></article>
            </section>
            <section className="dashboard-grid">
              <article className="panel goal-panel">
                <div className="panel-heading"><div><span className="section-kicker"><Target /> Meta mensal</span><h2>{goalPercent}% alcançado</h2></div><button type="button" className="text-button" onClick={() => setSettingsOpen(true)}>Alterar</button></div>
                <Progress value={goalPercent} aria-label={`${goalPercent}% da meta alcançada`} />
                <div className="goal-values"><span><strong>{money(totals.received)}</strong> recebidos</span><span>Meta: <strong>{money(goal)}</strong></span></div>
                <p className="goal-message">{goalRemaining > 0 ? `Faltam ${money(goalRemaining)} para chegar à meta.` : "Meta alcançada. Parabéns pelo resultado!"}</p>
              </article>
              <article className="panel reserve-panel">
                <div className="panel-heading"><span className="section-kicker"><PiggyBank /> Reserva</span><span className="reserve-percent">{data?.settings.reservePercent ?? 10}%</span></div>
                <strong className="reserve-value">{money(totals.reserve)}</strong><p>Separado automaticamente do valor recebido neste mês.</p>
                <div className="available-balance"><span>Saldo após a reserva</span><strong>{money(totals.available)}</strong></div>
              </article>
            </section>
            <section className="panel upcoming-panel">
              <div className="panel-heading"><div><span className="section-kicker"><Clock3 /> Próximos sete dias</span><h2>Próximos atendimentos</h2></div>{upcomingAppointments.length ? <span className="upcoming-count">{upcomingAppointments.length}</span> : null}</div>
              {upcomingAppointments.length ? <div className="upcoming-list">{upcomingAppointments.slice(0, 5).map((item) => <div className="upcoming-row" key={item.id}><div className="upcoming-date"><strong>{upcomingLabel(item)}</strong><span>{fullDate.format(parseDate(item.serviceDate))} às {item.serviceTime}</span></div><div className="upcoming-main"><strong>{item.clientName}</strong><span>{item.service}</span></div><span className={`status-text status-text--${item.status}`}>{APPOINTMENT_STATUS[item.status]}</span></div>)}</div>
              : <p className="upcoming-empty">Nenhum atendimento agendado para os próximos sete dias.</p>}
            </section>
            <section className="panel recent-panel">
              <div className="panel-heading"><div><span className="section-kicker">Movimentação recente</span><h2>Últimos atendimentos</h2></div>{monthAppointments.length > 0 ? <button type="button" className="text-button" onClick={() => setActiveTab("atendimentos")}>Ver todos</button> : null}</div>
              {monthAppointments.length ? <div className="record-list">{monthAppointments.slice(0, 4).map((item) => <div className="record-row" key={item.id}><div className="record-avatar" aria-hidden="true">{item.clientName.charAt(0).toUpperCase()}</div><div className="record-main"><strong>{item.clientName}</strong><span>{item.service} · {fullDate.format(parseDate(item.serviceDate))}{item.serviceTime ? ` às ${item.serviceTime}` : ""}</span></div><div className="record-money"><strong>{money(item.amountCents)}</strong><span className={`status-text status-text--${item.status}`}>{APPOINTMENT_STATUS[item.status]}</span></div></div>)}</div>
              : <EmptyState icon={<CalendarDays />} title="Seu mês começa aqui" text="Cadastre o primeiro atendimento para acompanhar ganhos e lucro." action="Cadastrar atendimento" onAction={() => setAppointmentOpen(true)} />}
            </section>
          </TabsContent>

          <TabsContent value="atendimentos" className="page-content">
            <PageHeading title="Agenda de atendimentos" description="Acompanhe horários e atualize cada atendimento até a conclusão." action="Novo atendimento" onAction={() => { setEditingAppointment(null); setAppointmentOpen(true); }} />
            <section className="panel list-panel">{monthAppointments.length ? <div className="data-list">{monthAppointments.map((item) => {
              const client = data?.clients.find((entry) => entry.id === item.clientId);
              return <article className={`data-row appointment-row appointment-row--${item.status}`} key={item.id}>
                <div className="data-date"><strong>{parseDate(item.serviceDate).getDate()}</strong><span>{fullDate.format(parseDate(item.serviceDate)).split(" ")[2]}</span></div>
                <div className="data-primary"><strong>{item.clientName}</strong><span>{item.service}</span><small><Clock3 /> {item.serviceTime || "Horário não informado"}</small></div>
                <div className="data-metric"><span>Recebido</span><strong>{money(item.paidCents)}</strong></div>
                <label className="status-control"><span>Status</span><select aria-label={`Status do atendimento de ${item.clientName}`} value={item.status} disabled={updatingAppointmentId === item.id} onChange={(event) => void updateAppointmentStatus(item.id, event.target.value as AppointmentStatus)}>{Object.entries(APPOINTMENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className={`data-metric ${item.pendingCents > 0 ? "data-metric--pending" : "data-metric--paid"}`}><span>Pendente</span><strong>{money(item.pendingCents)}</strong></div>
                <div className="row-actions">
                  <button className="icon-button edit-button" type="button" title="Editar atendimento" aria-label={`Editar atendimento de ${item.clientName}`} onClick={() => { setEditingAppointment(item); setAppointmentOpen(true); }}><Pencil /></button>
                  <button className="icon-button payment-button" type="button" disabled={item.pendingCents === 0 && item.payments.length === 0} title="Gerenciar pagamentos" aria-label={`Gerenciar pagamentos de ${item.clientName}`} onClick={() => setPaymentAppointment(item)}><Banknote /></button>
                  <button className="icon-button calendar-button" type="button" title="Adicionar à agenda" disabled={!item.serviceTime || item.status === "cancelled"} aria-label={`Adicionar atendimento de ${item.clientName} à agenda`} onClick={() => downloadCalendarEvent(item, client)}><CalendarPlus /></button>
                  <button className="icon-button whatsapp-button" type="button" title="Confirmar pelo WhatsApp" disabled={!client?.phone || !item.serviceTime || item.status === "cancelled"} aria-label={`Confirmar atendimento de ${item.clientName} pelo WhatsApp`} onClick={() => openWhatsAppConfirmation(item, client)}><MessageCircle /></button>
                  <button className="icon-button" type="button" title="Excluir atendimento" aria-label={`Excluir atendimento de ${item.clientName}`} onClick={() => setDeleteTarget({ type: "appointments", id: item.id, name: item.clientName })}><Trash2 /></button>
                </div>
              </article>;
            })}</div>
            : <EmptyState icon={<CalendarDays />} title="Nenhum atendimento neste mês" text="Quando você cadastrar um atendimento, ele aparecerá aqui." action="Cadastrar atendimento" onAction={() => setAppointmentOpen(true)} />}</section>
          </TabsContent>

          <TabsContent value="clientes" className="page-content">
            <PageHeading title="Clientes" description="Guarde os contatos, observações e o histórico de cada cliente." action="Nova cliente" onAction={() => { setEditingClient(null); setClientOpen(true); }} />
            <section className="panel list-panel">{data?.clients.length ? <div className="client-list">{data.clients.map((client) => {
              const history = data.appointments.filter((appointment) => appointment.clientId === client.id);
              const lastAppointment = history[0];
              return <article className="client-row" key={client.id}>
                <div className="record-avatar" aria-hidden="true">{client.name.charAt(0).toUpperCase()}</div>
                <div className="client-main"><strong>{client.name}</strong><span>{client.phone || "Telefone não informado"}</span>{client.notes ? <p>{client.notes}</p> : null}</div>
                <div className="client-history"><span>Histórico</span><strong>{history.length} {history.length === 1 ? "atendimento" : "atendimentos"}</strong><small>{lastAppointment ? `Último em ${fullDate.format(parseDate(lastAppointment.serviceDate))}` : "Nenhum atendimento ainda"}</small></div>
                <div className="row-actions"><button className="icon-button" type="button" aria-label={`Editar ${client.name}`} onClick={() => { setEditingClient(client); setClientOpen(true); }}><Pencil /></button><button className="icon-button" type="button" aria-label={`Excluir ${client.name}`} onClick={() => setDeleteTarget({ type: "clients", id: client.id, name: client.name })}><Trash2 /></button></div>
              </article>;
            })}</div> : <EmptyState icon={<Users />} title="Cadastre a primeira cliente" text="Depois, basta selecionar o nome dela ao criar um atendimento." action="Cadastrar cliente" onAction={() => { setEditingClient(null); setClientOpen(true); }} />}</section>
          </TabsContent>

          <TabsContent value="gastos" className="page-content">
            <PageHeading title="Gastos" description="Registre compras, transporte, aluguel e outras despesas do studio." action="Adicionar gasto" onAction={() => setExpenseOpen(true)} />
            <section className="mini-summary"><span>Total no mês</span><strong>{money(totals.expenses)}</strong></section>
            <section className="panel list-panel">{monthExpenses.length ? <div className="data-list">{monthExpenses.map((item) => <article className="data-row data-row--expense" key={item.id}><div className="category-icon"><ReceiptText /></div><div className="data-primary"><strong>{item.description}</strong><span>{item.category} · {fullDate.format(parseDate(item.expenseDate))}</span></div><div className="data-metric"><span>Valor</span><strong>{money(item.amountCents)}</strong></div><button className="icon-button" type="button" aria-label={`Excluir gasto ${item.description}`} onClick={() => setDeleteTarget({ type: "expenses", id: item.id, name: item.description })}><Trash2 /></button></article>)}</div>
            : <EmptyState icon={<ReceiptText />} title="Nenhum gasto neste mês" text="Adicione as despesas para descobrir seu lucro real." action="Adicionar gasto" onAction={() => setExpenseOpen(true)} />}</section>
          </TabsContent>

          <TabsContent value="produtos" className="page-content">
            <PageHeading title="Produtos" description="Informe o preço e o uso médio. O custo por atendimento é calculado sozinho." action="Cadastrar produto" onAction={() => { setEditingProduct(null); setProductOpen(true); }} />
            {data?.products.length ? <section className="product-grid">{data.products.map((product) => <article className="product-card" key={product.id}><div className="product-card-top"><div className="product-icon"><Box /></div><div className="row-actions"><button className="icon-button" type="button" aria-label={`Editar produto ${product.name}`} onClick={() => { setEditingProduct(product); setProductOpen(true); }}><Pencil /></button><button className="icon-button" type="button" aria-label={`Excluir produto ${product.name}`} onClick={() => setDeleteTarget({ type: "products", id: product.id, name: product.name })}><Trash2 /></button></div></div><h2>{product.name}</h2><p>{product.totalAmount} {product.unit} · uso médio de {product.usePerService} {product.unit}</p><div className="product-cost"><span>Custo por atendimento</span><strong>{money(product.costPerUseCents)}</strong></div></article>)}</section>
            : <section className="panel list-panel"><EmptyState icon={<PackagePlus />} title="Cadastre os produtos usados" text="Assim o custo de cada maquiagem será calculado automaticamente." action="Cadastrar produto" onAction={() => { setEditingProduct(null); setProductOpen(true); }} /></section>}
          </TabsContent>
        </>}
      </main>

      <AppointmentDialog open={appointmentOpen} onOpenChange={(open) => { setAppointmentOpen(open); if (!open) setEditingAppointment(null); }} appointment={editingAppointment} clients={data?.clients ?? []} products={data?.products ?? []} onSaved={loadData} onAddClient={() => { setEditingClient(null); setClientOpen(true); }} />
      <PaymentDialog appointment={paymentAppointment} onOpenChange={(open) => { if (!open) setPaymentAppointment(null); }} onSaved={loadData} />
      <ClientDialog open={clientOpen} onOpenChange={setClientOpen} client={editingClient} onSaved={loadData} />
      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} onSaved={loadData} />
      <ProductDialog open={productOpen} onOpenChange={(open) => { setProductOpen(open); if (!open) setEditingProduct(null); }} product={editingProduct} onSaved={loadData} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} data={data ?? { clients: [], products: [], appointments: [], expenses: [], settings: { monthlyGoalCents: 500000, reservePercent: 10 } }} onSaved={loadData} onChangePassword={() => { setSettingsOpen(false); setPasswordOpen(true); }} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir este registro?</AlertDialogTitle><AlertDialogDescription>{deleteTarget ? `“${deleteTarget.name}” será excluído. Essa ação não pode ser desfeita.` : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void deleteItem(); }} disabled={saving} className="delete-action">{saving ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Toaster position="top-center" richColors />
    </Tabs>
  );
}

function PageHeading({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) { return <div className="page-heading"><div><h2>{title}</h2><p>{description}</p></div><Button className="secondary-action" onClick={onAction}><Plus /> {action}</Button></div>; }
function EmptyState({ icon, title, text, action, onAction }: { icon: React.ReactNode; title: string; text: string; action: string; onAction: () => void }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p><Button variant="outline" onClick={onAction}><Plus /> {action}</Button></div>; }
function LoadingView() { return <div className="page-content loading-view" aria-label="Carregando"><div className="summary-grid">{[0,1,2,3].map((item) => <Skeleton className="h-40 rounded-[24px]" key={item} />)}</div><div className="dashboard-grid"><Skeleton className="h-64 rounded-[24px]" /><Skeleton className="h-64 rounded-[24px]" /></div><Skeleton className="h-72 rounded-[24px]" /></div>; }

function PaymentDialog({ appointment, onOpenChange, onSaved }: { appointment: Appointment | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);
  useEffect(() => { setEditingPayment(null); }, [appointment?.id]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!appointment) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await requestJson("/api/payments", { method: editingPayment ? "PUT" : "POST", body: JSON.stringify({ id: editingPayment?.id, appointmentId: appointment.id, amountCents: cents(String(form.get("paymentAmount") ?? "")), kind: form.get("paymentKind"), paidAt: form.get("paidAt"), note: form.get("paymentNote") }) });
      toast.success(editingPayment ? "Pagamento atualizado." : "Pagamento registrado.");
      setEditingPayment(null);
      onOpenChange(false);
      await onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível registrar o pagamento."); }
    finally { setSaving(false); }
  };
  const deletePayment = async (payment: Payment) => {
    if (!window.confirm(`Excluir o pagamento de ${money(payment.amountCents)}?`)) return;
    setDeletingPaymentId(payment.id);
    try {
      await requestJson(`/api/payments?id=${payment.id}`, { method: "DELETE" });
      toast.success("Pagamento excluído.");
      onOpenChange(false);
      await onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível excluir o pagamento."); }
    finally { setDeletingPaymentId(null); }
  };
  return <Dialog open={Boolean(appointment)} onOpenChange={(open) => { if (!open) setEditingPayment(null); onOpenChange(open); }}><DialogContent className="form-dialog form-dialog--small"><DialogHeader><DialogTitle>{editingPayment ? "Editar pagamento" : "Registrar pagamento"}</DialogTitle><DialogDescription>{appointment ? `${appointment.clientName} · ${appointment.service}` : ""}</DialogDescription></DialogHeader>{appointment ? <form key={`${appointment.id}-${editingPayment?.id ?? "new"}`} onSubmit={submit} className="form-grid form-grid--single">
    <div className="payment-summary"><span><small>Valor total</small><strong>{money(appointment.amountCents)}</strong></span><span><small>Recebido</small><strong>{money(appointment.paidCents)}</strong></span><span className="payment-summary--pending"><small>Pendente</small><strong>{money(appointment.pendingCents)}</strong></span></div>
    <Field id="paymentAmount" label="Valor recebido"><div className="money-input"><span>R$</span><input id="paymentAmount" name="paymentAmount" inputMode="decimal" required placeholder="0,00" defaultValue={editingPayment ? (editingPayment.amountCents / 100).toFixed(2).replace(".", ",") : ""} /></div></Field>
    <Field id="paymentKind" label="Tipo"><Select name="paymentKind" defaultValue={editingPayment?.kind ?? (appointment.paidCents === 0 ? "deposit" : "partial")}><SelectTrigger id="paymentKind" className="field-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deposit">Sinal</SelectItem><SelectItem value="partial">Pagamento parcial</SelectItem><SelectItem value="final">Pagamento final</SelectItem>{editingPayment?.kind === "full" ? <SelectItem value="full">Pagamento integral</SelectItem> : null}</SelectContent></Select></Field>
    <Field id="paidAt" label="Data do pagamento"><input className="field-control" id="paidAt" name="paidAt" type="date" defaultValue={editingPayment?.paidAt.slice(0, 10) ?? todayInput()} required /></Field>
    <Field id="paymentNote" label="Observação" hint="Opcional"><input className="field-control" id="paymentNote" name="paymentNote" placeholder="Ex.: Pix" defaultValue={editingPayment?.note ?? ""} /></Field>
    {appointment.payments.length ? <div className="payment-history"><strong>Pagamentos anteriores</strong>{appointment.payments.map((payment) => <div className="payment-history-row" key={payment.id}><span>{PAYMENT_KIND[payment.kind]} · {fullDate.format(parseDate(payment.paidAt))}</span><strong>{money(payment.amountCents)}</strong><div className="payment-history-actions"><button className="icon-button" type="button" title="Editar pagamento" aria-label={`Editar pagamento de ${money(payment.amountCents)}`} onClick={() => setEditingPayment(payment)}><Pencil /></button><button className="icon-button" type="button" title="Excluir pagamento" aria-label={`Excluir pagamento de ${money(payment.amountCents)}`} disabled={deletingPaymentId === payment.id} onClick={() => void deletePayment(payment)}>{deletingPaymentId === payment.id ? <Loader2 className="animate-spin" /> : <Trash2 />}</button></div></div>)}</div> : null}
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => { if (editingPayment) setEditingPayment(null); else onOpenChange(false); }}>{editingPayment ? "Cancelar edição" : "Cancelar"}</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : editingPayment ? <Pencil /> : <Banknote />} {editingPayment ? "Salvar alterações" : "Salvar pagamento"}</Button></DialogFooter>
  </form> : null}</DialogContent></Dialog>;
}

function ClientDialog({ open, onOpenChange, client, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; client: Client | null; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    try {
      await requestJson("/api/clients", {
        method: client ? "PUT" : "POST",
        body: JSON.stringify({ id: client?.id, name: form.get("clientName"), phone: form.get("clientPhone"), notes: form.get("clientNotes") }),
      });
      toast.success(client ? "Cliente atualizada." : "Cliente cadastrada.");
      formElement.reset();
      onOpenChange(false);
      await onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar a cliente."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog form-dialog--small"><DialogHeader><DialogTitle>{client ? "Editar cliente" : "Nova cliente"}</DialogTitle><DialogDescription>Essas informações ficam disponíveis apenas na conta do studio.</DialogDescription></DialogHeader><form key={client?.id ?? "new"} onSubmit={submit} className="form-grid form-grid--single">
    <Field id="clientName" label="Nome"><input className="field-control" id="clientName" name="clientName" required autoComplete="name" placeholder="Ex.: Fernanda" defaultValue={client?.name ?? ""} /></Field>
    <Field id="clientPhone" label="Telefone" hint="Pode incluir DDD"><div className="input-with-icon"><Phone /><input id="clientPhone" name="clientPhone" type="tel" autoComplete="tel" placeholder="(11) 99999-9999" defaultValue={client?.phone ?? ""} /></div></Field>
    <Field id="clientNotes" label="Observações" hint="Preferências, alergias ou informações importantes"><Textarea id="clientNotes" name="clientNotes" maxLength={1000} placeholder="Ex.: prefere maquiagem leve" defaultValue={client?.notes ?? ""} /></Field>
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <UserPlus />} {client ? "Salvar alterações" : "Cadastrar cliente"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function AppointmentDialog({ open, onOpenChange, appointment, clients, products, onSaved, onAddClient }: { open: boolean; onOpenChange: (open: boolean) => void; appointment: Appointment | null; clients: Client[]; products: Product[]; onSaved: () => Promise<void>; onAddClient: () => void }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [productsChanged, setProductsChanged] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSelected(appointment?.productIds ?? []);
    setProductsChanged(false);
    setSelectedServices(appointment ? appointment.service.split(" + ").filter(Boolean) : []);
  }, [open, appointment]);
  const productCost = products.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.costPerUseCents, 0);
  const legacyProductCost = Boolean(appointment && appointment.productIds.length === 0 && appointment.productCostCents > 0);
  const displayedProductCost = appointment && !productsChanged ? appointment.productCostCents : productCost;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedServices.length) { toast.error("Escolha pelo menos um serviço."); return; }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    try {
      await requestJson("/api/appointments", {
        method: appointment ? "PUT" : "POST",
        body: JSON.stringify({
          id: appointment?.id,
          clientId: Number(form.get("clientId")),
          service: selectedServices.join(" + "),
          serviceDate: form.get("serviceDate"),
          serviceTime: form.get("serviceTime"),
          amountCents: cents(String(form.get("amount") ?? "")),
          depositCents: appointment ? 0 : cents(String(form.get("deposit") ?? "")),
          depositPaidAt: todayInput(),
          extraCostCents: cents(String(form.get("extraCost") ?? "")),
          paymentFeeCents: cents(String(form.get("paymentFee") ?? "")),
          productIds: selected,
          productsChanged: appointment ? productsChanged : true,
        }),
      });
      toast.success(appointment ? "Atendimento atualizado." : "Atendimento agendado. Os valores já foram calculados.");
      formElement.reset();
      setSelected([]);
      setProductsChanged(false);
      setSelectedServices([]);
      onOpenChange(false);
      await onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>{appointment ? "Editar atendimento" : "Novo atendimento"}</DialogTitle><DialogDescription>{appointment ? "Altere cliente, serviços, data, horário ou valores quando precisar." : "Preencha o básico. Os cálculos são feitos automaticamente."}</DialogDescription></DialogHeader><form key={appointment?.id ?? "new"} onSubmit={submit} className="form-grid">
    <Field id="clientId" label="Cliente"><Select name="clientId" required disabled={!clients.length} defaultValue={appointment?.clientId ? String(appointment.clientId) : undefined}><SelectTrigger id="clientId" className="field-control"><SelectValue placeholder={clients.length ? "Selecione a cliente" : "Cadastre uma cliente primeiro"} /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}</SelectContent></Select>{!clients.length ? <button className="inline-create-button" type="button" onClick={() => { onOpenChange(false); onAddClient(); }}><UserPlus /> Cadastrar cliente agora</button> : null}</Field>
    <div className="product-picker service-picker"><div className="product-picker-heading"><div><strong>Serviços</strong><span>Escolha um ou mais serviços</span></div></div>{SERVICES.map((service) => <label className="product-option service-option" key={service}><Checkbox checked={selectedServices.includes(service)} onCheckedChange={(checked) => setSelectedServices((current) => checked ? [...current, service] : current.filter((item) => item !== service))} /><span>{service}</span></label>)}</div>
    <Field id="serviceDate" label="Data"><input className="field-control" id="serviceDate" name="serviceDate" type="date" defaultValue={appointment?.serviceDate ?? todayInput()} required /></Field>
    <Field id="serviceTime" label="Horário"><input className="field-control" id="serviceTime" name="serviceTime" type="time" defaultValue={appointment?.serviceTime ?? ""} required /></Field>
    <Field id="amount" label="Valor cobrado"><div className="money-input"><span>R$</span><input id="amount" name="amount" inputMode="decimal" placeholder="180,00" required defaultValue={appointment ? (appointment.amountCents / 100).toFixed(2).replace(".", ",") : ""} /></div></Field>
    {!appointment ? <Field id="deposit" label="Sinal recebido" hint="Deixe em branco se ainda não recebeu"><div className="money-input"><span>R$</span><input id="deposit" name="deposit" inputMode="decimal" placeholder="0,00" /></div></Field> : null}
    <Field id="extraCost" label="Outros custos" hint="Ex.: deslocamento ou cílios"><div className="money-input"><span>R$</span><input id="extraCost" name="extraCost" inputMode="decimal" placeholder="0,00" defaultValue={appointment ? (appointment.extraCostCents / 100).toFixed(2).replace(".", ",") : ""} /></div></Field>
    <Field id="paymentFee" label="Taxa de pagamento" hint="Taxa da maquininha, se houver"><div className="money-input"><span>R$</span><input id="paymentFee" name="paymentFee" inputMode="decimal" placeholder="0,00" defaultValue={appointment ? (appointment.paymentFeeCents / 100).toFixed(2).replace(".", ",") : ""} /></div></Field>
    <div className="product-picker"><div className="product-picker-heading"><div><strong>Produtos usados</strong><span>Marque apenas o que foi realmente usado neste atendimento</span></div><strong>{money(displayedProductCost)}</strong></div>{legacyProductCost && !productsChanged ? <p className="legacy-product-warning">Este atendimento foi criado antes da lista de produtos existir. O custo antigo será preservado; para corrigi-lo, marque todos os produtos usados.</p> : null}{products.length ? products.map((product) => <label className="product-option" key={product.id}><Checkbox checked={selected.includes(product.id)} onCheckedChange={(checked) => { setProductsChanged(true); setSelected((current) => checked ? [...new Set([...current, product.id])] : current.filter((id) => id !== product.id)); }} /><span>{product.name}</span><strong>{money(product.costPerUseCents)}</strong></label>) : <p className="picker-empty">Nenhum produto cadastrado ainda. Você pode salvar o atendimento mesmo assim.</p>}</div>
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : appointment ? <Pencil /> : <Banknote />} {appointment ? "Salvar alterações" : "Salvar atendimento"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function ExpenseDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setSaving(true); try { await requestJson("/api/expenses", { method: "POST", body: JSON.stringify({ description: form.get("description"), category: form.get("category"), expenseDate: form.get("expenseDate"), amountCents: cents(String(form.get("expenseAmount") ?? "")) }) }); toast.success("Gasto adicionado."); formElement.reset(); onOpenChange(false); await onSaved(); } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog form-dialog--small"><DialogHeader><DialogTitle>Adicionar gasto</DialogTitle><DialogDescription>Esse valor será descontado do lucro do mês.</DialogDescription></DialogHeader><form onSubmit={submit} className="form-grid">
    <Field id="description" label="Descrição"><input className="field-control" id="description" name="description" required placeholder="Ex.: Reposição de algodão" /></Field>
    <Field id="category" label="Categoria"><Select name="category" required><SelectTrigger id="category" className="field-control"><SelectValue placeholder="Escolha uma categoria" /></SelectTrigger><SelectContent><SelectItem value="Produtos e materiais">Produtos e materiais</SelectItem><SelectItem value="Transporte">Transporte</SelectItem><SelectItem value="Aluguel e contas">Aluguel e contas</SelectItem><SelectItem value="Divulgação">Divulgação</SelectItem><SelectItem value="Outros">Outros</SelectItem></SelectContent></Select></Field>
    <Field id="expenseDate" label="Data"><input className="field-control" id="expenseDate" name="expenseDate" type="date" defaultValue={todayInput()} required /></Field>
    <Field id="expenseAmount" label="Valor"><div className="money-input"><span>R$</span><input id="expenseAmount" name="expenseAmount" inputMode="decimal" placeholder="80,00" required /></div></Field>
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <ReceiptText />} Salvar gasto</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function ProductDialog({ open, onOpenChange, product, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; product: Product | null; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({ price: "", total: "", use: "" });
  useEffect(() => {
    if (!open) return;
    setPreview(product ? {
      price: (product.purchasePriceCents / 100).toFixed(2).replace(".", ","),
      total: String(product.totalAmount).replace(".", ","),
      use: String(product.usePerService).replace(".", ","),
    } : { price: "", total: "", use: "" });
  }, [open, product]);
  const total = Number(preview.total.replace(",", ".")); const use = Number(preview.use.replace(",", "."));
  const previewCost = total > 0 && use > 0 ? Math.round((cents(preview.price) / total) * use) : 0;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setSaving(true); try { await requestJson("/api/products", { method: product ? "PUT" : "POST", body: JSON.stringify({ id: product?.id, name: form.get("productName"), purchasePriceCents: cents(String(form.get("productPrice") ?? "")), totalAmount: Number(String(form.get("totalAmount") ?? "").replace(",", ".")), unit: form.get("unit"), usePerService: Number(String(form.get("usePerService") ?? "").replace(",", ".")) }) }); toast.success(product ? "Produto atualizado. Os atendimentos antigos não foram alterados." : "Produto cadastrado e custo calculado."); formElement.reset(); setPreview({ price: "", total: "", use: "" }); onOpenChange(false); await onSaved(); } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>{product ? "Editar produto" : "Cadastrar produto"}</DialogTitle><DialogDescription>{product ? "A alteração vale para os próximos cálculos. Atendimentos antigos mantêm o custo registrado." : "Use as informações da embalagem. Não precisa fazer nenhuma conta."}</DialogDescription></DialogHeader><form key={product?.id ?? "new"} onSubmit={submit} className="form-grid">
    <Field id="productName" label="Nome do produto"><input className="field-control" id="productName" name="productName" required placeholder="Ex.: Base líquida" defaultValue={product?.name ?? ""} /></Field>
    <Field id="productPrice" label="Preço pago"><div className="money-input"><span>R$</span><input id="productPrice" name="productPrice" inputMode="decimal" placeholder="80,00" required value={preview.price} onChange={(e) => setPreview({ ...preview, price: e.target.value })} /></div></Field>
    <Field id="totalAmount" label="Quantidade da embalagem"><input className="field-control" id="totalAmount" name="totalAmount" inputMode="decimal" required placeholder="30" value={preview.total} onChange={(e) => setPreview({ ...preview, total: e.target.value })} /></Field>
    <Field id="unit" label="Unidade"><Select name="unit" defaultValue={product?.unit ?? "ml"}><SelectTrigger id="unit" className="field-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ml">ml</SelectItem><SelectItem value="g">gramas</SelectItem><SelectItem value="un.">unidades</SelectItem></SelectContent></Select></Field>
    <Field id="usePerService" label="Uso médio por atendimento" hint="Uma estimativa já é suficiente"><input className="field-control" id="usePerService" name="usePerService" inputMode="decimal" required placeholder="1" value={preview.use} onChange={(e) => setPreview({ ...preview, use: e.target.value })} /></Field>
    <div className="cost-preview"><span>Custo por atendimento: preço ÷ quantidade × uso médio</span><strong>{money(Number.isFinite(previewCost) ? previewCost : 0)}</strong></div>
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : product ? <Pencil /> : <PackagePlus />} {product ? "Salvar alterações" : "Salvar produto"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function SettingsDialog({ open, onOpenChange, data, onSaved, onChangePassword }: { open: boolean; onOpenChange: (open: boolean) => void; data: StudioData; onSaved: () => Promise<void>; onChangePassword: () => void }) {
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<StudioBackup | null>(null);
  const [backupFileName, setBackupFileName] = useState("");
  const backupInputRef = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); try { await requestJson("/api/settings", { method: "PUT", body: JSON.stringify({ monthlyGoalCents: cents(String(form.get("monthlyGoal") ?? "")), reservePercent: Number(String(form.get("reservePercent") ?? "").replace(",", ".")) }) }); toast.success("Meta e reserva atualizadas."); onOpenChange(false); await onSaved(); } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); } };
  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const toastId = toast.loading("Verificando o backup...");
    try {
      const backup = await readBackupFile(file);
      setPendingBackup(backup);
      setBackupFileName(file.name);
      toast.success("Backup verificado. Confira o resumo antes de importar.", { id: toastId });
    } catch (error) {
      setPendingBackup(null);
      setBackupFileName("");
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o backup.", { id: toastId, duration: 7000 });
    }
  };
  const confirmImport = async () => {
    if (!pendingBackup) return;
    setImporting(true);
    const toastId = toast.loading("Importando os dados com segurança...");
    try {
      const result = await importStudioBackup(pendingBackup);
      setPendingBackup(null);
      setBackupFileName("");
      await onSaved();
      toast.success(`${result.added} registro(s) adicionado(s). ${result.kept} já existia(m) e foi(ram) mantido(s).`, { id: toastId, duration: 6500 });
    } catch (error) {
      toast.error(error instanceof Error ? `${error.message} Você pode tentar novamente; os registros já importados não serão duplicados.` : "Não foi possível importar o backup.", { id: toastId, duration: 8000 });
    } finally { setImporting(false); }
  };
  const totalPending = pendingBackup ? pendingBackup.clients.length + pendingBackup.products.length + pendingBackup.appointments.length + pendingBackup.payments.length + pendingBackup.expenses.length : 0;
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !importing) { setPendingBackup(null); setBackupFileName(""); } onOpenChange(nextOpen); }}><DialogContent className="form-dialog form-dialog--small"><DialogHeader><DialogTitle>Meta, backup e segurança</DialogTitle><DialogDescription>Gerencie as preferências e mantenha uma cópia dos dados do studio.</DialogDescription></DialogHeader><form onSubmit={submit} className="form-grid">
    <Field id="monthlyGoal" label="Meta de faturamento mensal"><div className="money-input"><span>R$</span><input id="monthlyGoal" name="monthlyGoal" inputMode="decimal" required defaultValue={(data.settings.monthlyGoalCents / 100).toFixed(2).replace(".", ",")} /></div></Field>
    <Field id="reservePercent" label="Porcentagem para reserva" hint="Ex.: 10 significa guardar 10% do faturamento"><div className="percent-input"><input id="reservePercent" name="reservePercent" type="number" min="0" max="100" step="0.5" defaultValue={data.settings.reservePercent} required /><span>%</span></div></Field>
    <div className="backup-box"><div><strong>Exportar dados</strong><span>Baixe manualmente um arquivo Excel organizado em abas, com resumo, clientes, atendimentos, pagamentos, gastos, produtos e configurações.</span></div><Button type="button" variant="outline" onClick={() => void downloadBackup(data)}><Download /> Exportar Excel</Button></div>
    <div className="backup-box backup-box--import"><div><strong>Importar dados</strong><span>Selecione um backup Excel criado pelo Studio em Dia. O sistema adiciona somente o que estiver faltando e mantém os registros atuais.</span></div><input ref={backupInputRef} className="backup-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectBackup(event)} /><Button type="button" variant="outline" disabled={saving || importing} onClick={() => backupInputRef.current?.click()}><Upload /> Escolher backup</Button></div>
    {pendingBackup ? <div className="import-preview" role="status"><div><strong>Backup pronto para importar</strong><span>{backupFileName} · {totalPending} registros</span></div><ul><li>{pendingBackup.clients.length} clientes</li><li>{pendingBackup.appointments.length} atendimentos</li><li>{pendingBackup.payments.length} pagamentos</li><li>{pendingBackup.expenses.length} gastos</li><li>{pendingBackup.products.length} produtos</li></ul><p>Nada será apagado ou substituído. Registros já existentes e suas configurações atuais serão mantidos.</p><div className="import-preview__actions"><Button type="button" variant="ghost" disabled={importing} onClick={() => { setPendingBackup(null); setBackupFileName(""); }}>Cancelar</Button><Button type="button" disabled={importing} onClick={() => void confirmImport()}>{importing ? <Loader2 className="animate-spin" /> : <Upload />} Confirmar importação</Button></div></div> : null}
    <div className="backup-box security-box"><div><strong>Segurança da conta</strong><span>Troque a senha sem alterar clientes, atendimentos, produtos ou qualquer outro dado do studio.</span></div><Button type="button" variant="outline" onClick={onChangePassword}><KeyRound /> Alterar senha</Button></div>
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" disabled={importing} onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving || importing}>{saving ? <Loader2 className="animate-spin" /> : <Target />} Salvar preferências</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const password = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) { setError("A nova senha e a confirmação precisam ser iguais."); return; }
    if (password === currentPassword) { setError("A nova senha precisa ser diferente da senha atual."); return; }
    setSaving(true); setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password, current_password: currentPassword });
    if (updateError) {
      setError(updateError.message.toLowerCase().includes("password") ? "A senha atual está incorreta ou a nova senha não atende aos requisitos." : "Não foi possível alterar a senha. Tente novamente.");
      setSaving(false);
      return;
    }
    toast.success("Senha alterada com sucesso.");
    formElement.reset();
    onOpenChange(false);
    setSaving(false);
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => { setError(""); onOpenChange(nextOpen); }}><DialogContent className="form-dialog form-dialog--small"><DialogHeader><DialogTitle>Alterar senha</DialogTitle><DialogDescription>Use pelo menos 12 caracteres. Seus dados do studio não serão alterados.</DialogDescription></DialogHeader><form onSubmit={submit} className="form-grid password-form">
    <Field id="currentPassword" label="Senha atual"><input className="field-control" id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required placeholder="Digite a senha atual" /></Field>
    <Field id="newPassword" label="Nova senha"><input className="field-control" id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required placeholder="Mínimo de 12 caracteres" /></Field>
    <Field id="passwordConfirmation" label="Confirmar nova senha"><input className="field-control" id="passwordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} required placeholder="Digite novamente" /></Field>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <DialogFooter className="form-footer"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <KeyRound />} Salvar nova senha</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
