/**
 * A band's mixer templates: named lists of channel name → gain and pan that
 * admins apply to a song's mixer, matching tracks and stacks by name.
 *
 *   GET    /api/bands/:bandId/mixer-templates                       list
 *   PUT    /api/bands/:bandId/mixer-templates/:templateId           create or replace
 *   DELETE /api/bands/:bandId/mixer-templates/:templateId           delete
 *   POST   /api/bands/:bandId/mixer-templates/:templateId/default   `{ isDefault }`, at most one per band
 *
 * All need `song.audio.write`, the same capability as saving a song's mix.
 * Postgres only: the GitHub Pages build never reads them.
 */
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { mixerTemplateWriteSchema } from '../../../src/config/schema';
import type { MixerTemplate } from '../../../src/audio/types';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId } from '../auth/can';
import { HttpError, json, ok } from '../http';
import type { Actor, CoreRequest, CoreResponse } from '../types';
import { audit } from './members';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = typeof schema.mixerTemplate.$inferSelect;

function toTemplate(row: Row): MixerTemplate {
  const config = row.config as Pick<MixerTemplate, 'stems' | 'groups'>;
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    stems: config.stems ?? [],
    groups: config.groups ?? [],
  };
}

function templateId(req: CoreRequest): string {
  const id = req.params.templateId;
  if (!UUID.test(id)) throw new HttpError(400, 'Bad template id');
  return id;
}

function actorOf(req: CoreRequest): Actor {
  if (!req.actor) throw new HttpError(401, 'Sign in first');
  return req.actor;
}

/** The template, if it's this band's. */
async function findOwn(bandId: string, id: string): Promise<Row | undefined> {
  const [row] = await db().select().from(schema.mixerTemplate).where(eq(schema.mixerTemplate.id, id));
  if (row && row.bandId !== bandId) throw new HttpError(404, 'Template not found');
  return row;
}

export async function listMixerTemplates(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const rows = await db().select().from(schema.mixerTemplate)
    .where(eq(schema.mixerTemplate.bandId, band.id))
    .orderBy(asc(sql`lower(${schema.mixerTemplate.name})`));
  return json({ templates: rows.map(toTemplate) });
}

export async function putMixerTemplate(req: CoreRequest): Promise<CoreResponse> {
  const actor = actorOf(req);
  const id = templateId(req);
  const { name, stems, groups } = mixerTemplateWriteSchema.parse(req.body);
  const band = await bandByLegacyId(req.params.bandId);
  const existing = await findOwn(band.id, id);

  const [clash] = await db().select({ id: schema.mixerTemplate.id }).from(schema.mixerTemplate)
    .where(and(
      eq(schema.mixerTemplate.bandId, band.id),
      eq(sql`lower(${schema.mixerTemplate.name})`, name.toLowerCase()),
      ne(schema.mixerTemplate.id, id),
    ));
  if (clash) throw new HttpError(409, `There's already a template called "${name}"`);

  const config = { stems, groups };
  const row = await db().transaction(async (tx) => {
    const [saved] = existing
      ? await tx.update(schema.mixerTemplate)
        .set({ name, config, updatedAt: new Date() })
        .where(eq(schema.mixerTemplate.id, id))
        .returning()
      : await tx.insert(schema.mixerTemplate)
        .values({ id, bandId: band.id, name, config })
        .returning();
    await audit(tx, band, actor, existing ? 'mixer.template.update' : 'mixer.template.create', id, { name });
    return saved;
  });
  return json({ template: toTemplate(row) });
}

export async function deleteMixerTemplate(req: CoreRequest): Promise<CoreResponse> {
  const actor = actorOf(req);
  const id = templateId(req);
  const band = await bandByLegacyId(req.params.bandId);
  const existing = await findOwn(band.id, id);
  if (!existing) return ok();
  await db().transaction(async (tx) => {
    await tx.delete(schema.mixerTemplate).where(eq(schema.mixerTemplate.id, id));
    await audit(tx, band, actor, 'mixer.template.delete', id, { name: existing.name });
  });
  return ok();
}

const defaultBody = z.object({ isDefault: z.boolean() });

export async function setDefaultMixerTemplate(req: CoreRequest): Promise<CoreResponse> {
  const actor = actorOf(req);
  const id = templateId(req);
  const { isDefault } = defaultBody.parse(req.body);
  const band = await bandByLegacyId(req.params.bandId);
  const existing = await findOwn(band.id, id);
  if (!existing) throw new HttpError(404, 'Template not found');
  await db().transaction(async (tx) => {
    if (isDefault) {
      await tx.update(schema.mixerTemplate).set({ isDefault: false })
        .where(and(eq(schema.mixerTemplate.bandId, band.id), ne(schema.mixerTemplate.id, id)));
    }
    await tx.update(schema.mixerTemplate).set({ isDefault }).where(eq(schema.mixerTemplate.id, id));
    await audit(tx, band, actor, 'mixer.template.default', id, { isDefault });
  });
  return ok();
}
