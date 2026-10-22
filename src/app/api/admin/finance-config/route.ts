import { Role, StandardReasonAction } from "@prisma-generated/enums";
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { allocationRows, numberValue } from "@/lib/finance-management";
import { prisma } from "@/lib/db";

const tagSchema = z.object({
  resource: z.literal("tag"),
  action: z.literal("save"),
  id: z.string().optional(),
  name: z.string().trim().min(2).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  active: z.boolean().default(true),
});

const reasonSchema = z.object({
  resource: z.literal("reason"),
  action: z.literal("save"),
  id: z.string().optional(),
  label: z.string().trim().min(3).max(120),
  reasonAction: z.nativeEnum(StandardReasonAction),
  sortOrder: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

const allocationRuleSchema = z.object({
  resource: z.literal("allocation_rule"),
  action: z.literal("save"),
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().max(80).nullable().optional(),
  supplierPattern: z.string().trim().max(100).nullable().optional(),
  priority: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  splits: z.array(
    z.object({ workId: z.string().min(1), percentage: z.number().positive().max(100) }),
  ).min(2),
});

const deleteSchema = z.object({
  resource: z.enum(["tag", "reason", "allocation_rule"]),
  action: z.literal("delete"),
  id: z.string().min(1),
});

const bodySchema = z.discriminatedUnion("resource", [
  tagSchema,
  reasonSchema,
  allocationRuleSchema,
]).or(deleteSchema);

function clean(value: string | null | undefined) {
  return value?.trim() || null;
}

export async function GET() {
  try {
    await requireRole([Role.ADMINISTRADOR]);
    const [works, tags, reasons, allocationRules] = await Promise.all([
      prisma.work.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.tag.findMany({ orderBy: { name: "asc" } }),
      prisma.standardReason.findMany({ orderBy: [{ action: "asc" }, { sortOrder: "asc" }] }),
      prisma.allocationRule.findMany({
        orderBy: [{ priority: "desc" }, { name: "asc" }],
        include: { splits: { include: { work: true }, orderBy: { work: { name: "asc" } } } },
      }),
    ]);

    return ok({
      works,
      tags,
      reasons,
      allocationRules: allocationRules.map((rule) => ({
        ...rule,
        splits: rule.splits.map((split) => ({
          ...split,
          percentage: numberValue(split.percentage),
        })),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRole([Role.ADMINISTRADOR]);
    const body = bodySchema.parse(await request.json());

    if (body.action === "delete") {
      if (body.resource === "tag") {
        await prisma.tag.delete({ where: { id: body.id } });
      } else if (body.resource === "reason") {
        await prisma.standardReason.delete({ where: { id: body.id } });
      } else {
        await prisma.allocationRule.delete({ where: { id: body.id } });
      }
      await auditLog({
        actorId: actor.id,
        event: "CONFIG_FINANCEIRA_EXCLUIDA",
        entity: body.resource,
        entityId: body.id,
      });
      return ok({ deleted: true });
    }

    let entityId = body.id;
    if (body.resource === "tag") {
      const data = { name: body.name, color: body.color, active: body.active };
      const saved = body.id
        ? await prisma.tag.update({ where: { id: body.id }, data })
        : await prisma.tag.create({ data });
      entityId = saved.id;
    } else if (body.resource === "reason") {
      const data = {
        label: body.label,
        action: body.reasonAction,
        sortOrder: body.sortOrder,
        active: body.active,
      };
      const saved = body.id
        ? await prisma.standardReason.update({ where: { id: body.id }, data })
        : await prisma.standardReason.create({ data });
      entityId = saved.id;
    } else {
      allocationRows(100, body.splits);
      const duplicateWorks = new Set(body.splits.map((split) => split.workId));
      if (duplicateWorks.size !== body.splits.length) {
        throw new ApiError(400, "Cada obra pode aparecer apenas uma vez no rateio.");
      }
      const data = {
        name: body.name,
        category: clean(body.category),
        supplierPattern: clean(body.supplierPattern),
        priority: body.priority,
        active: body.active,
        splits: {
          create: body.splits.map((split) => ({
            workId: split.workId,
            percentage: split.percentage,
          })),
        },
      };
      const saved = await prisma.$transaction(async (tx) => {
        if (!body.id) return tx.allocationRule.create({ data });
        await tx.allocationRuleSplit.deleteMany({ where: { ruleId: body.id } });
        return tx.allocationRule.update({ where: { id: body.id }, data });
      });
      entityId = saved.id;
    }

    await auditLog({
      actorId: actor.id,
      event: "CONFIG_FINANCEIRA_SALVA",
      entity: body.resource,
      entityId,
      metadata: { nome: "name" in body ? body.name : "label" in body ? body.label : "" },
    });
    return ok({ saved: true, id: entityId });
  } catch (error) {
    return handleApiError(error);
  }
}
