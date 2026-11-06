import { describe, expect, it } from 'vitest';
import { canInteract, isGuildAllowed, isUserAllowed } from '../src/application/authorization.js';

const policy = {
  allowedUserIds: ['111111111111111111', '222222222222222222'],
  allowedGuildIds: ['999999999999999999'],
};

describe('authorization (allowlist, fail-closed)', () => {
  it('acepta usuarios en la allowlist', () => {
    expect(isUserAllowed(policy, '111111111111111111')).toBe(true);
  });

  it('rechaza usuarios fuera de la allowlist', () => {
    expect(isUserAllowed(policy, '333333333333333333')).toBe(false);
  });

  it('rechaza a todos si la allowlist de usuarios esta vacia', () => {
    const empty = { allowedUserIds: [], allowedGuildIds: [] };
    expect(isUserAllowed(empty, '111111111111111111')).toBe(false);
  });

  it('sin allowlist de guilds, cualquier servidor es permitido', () => {
    const anyGuild = { ...policy, allowedGuildIds: [] };
    expect(isGuildAllowed(anyGuild, '123456789012345678')).toBe(true);
    expect(isGuildAllowed(anyGuild, null)).toBe(true);
  });

  it('con allowlist de guilds, rechaza servidores no listados y contexto sin guild', () => {
    expect(isGuildAllowed(policy, '999999999999999999')).toBe(true);
    expect(isGuildAllowed(policy, '888888888888888888')).toBe(false);
    expect(isGuildAllowed(policy, null)).toBe(false);
  });

  it('canInteract exige usuario Y servidor autorizados', () => {
    expect(canInteract(policy, '111111111111111111', '999999999999999999')).toBe(true);
    expect(canInteract(policy, '333333333333333333', '999999999999999999')).toBe(false);
    expect(canInteract(policy, '111111111111111111', '888888888888888888')).toBe(false);
  });
});
