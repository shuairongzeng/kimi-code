/**
 * Welcome panel shown at the top of the TUI.
 * Renders a round-bordered box with the logo, session, model, and version.
 */

import type { Component } from '@zimi-ai/pi-tui';
import { truncateToWidth, visibleWidth } from '@zimi-ai/pi-tui';
import chalk from 'chalk';

import { effectiveModelAlias } from '@zimi-ai/zimi-code-sdk';

import { isRainbowDancing, renderDanceWelcomeHeader } from '#/tui/easter-eggs/dance';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';

export class WelcomeComponent implements Component {
  private state: AppState;

  constructor(state: AppState) {
    this.state = state;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    const primary = (s: string): string => chalk.hex(currentTheme.palette.primary)(s);
    const isLoggedOut = !this.state.model;
    const activeModel = this.state.availableModels[this.state.model];
    const effectiveActiveModel = activeModel === undefined ? undefined : effectiveModelAlias(activeModel);

    if (safeWidth < 24) {
      const title = chalk.bold.hex(currentTheme.palette.primary)('Welcome to Zimi Code!');
      const prompt = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('Run /login or /provider to get started.')
        : chalk.hex(currentTheme.palette.textDim)('Send /help for help information.');
      const model = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('not set, run /login or /provider')
        : (effectiveActiveModel?.displayName ?? effectiveActiveModel?.model ?? this.state.model);
      return ['', title, prompt, `Model: ${model}`].map((line) =>
        truncateToWidth(line, safeWidth, '…'),
      );
    }

    const innerWidth = Math.max(1, safeWidth - 4);
    const pad = '  ';

    // Logo + side-by-side text. Two-tone: the Z glyph rows render in the
    // theme primary; the amber cursor (last cell of row 1) renders in the
    // theme accent — matching the SVG mark's cursor motif.
    const logo = ['▀▀▀█▛', '▄██▖▄'] as const;
    const logoWidth = Math.max(...logo.map((row) => visibleWidth(row)));
    const gap = '  ';
    const textWidth = Math.max(4, innerWidth - logoWidth - gap.length);
    const logoRow0 = primary(logo[0]);
    const logoRow1 =
      primary(logo[1].slice(0, 4)) + chalk.hex(currentTheme.palette.accent)(logo[1].slice(4));

    const rightRow0 = truncateToWidth(
      chalk.bold.hex(currentTheme.palette.primary)('Welcome to Zimi Code!'),
      textWidth,
      '…',
    );
    const dim = chalk.hex(currentTheme.palette.textDim);
    const labelStyle = chalk.bold.hex(currentTheme.palette.textDim);
    const rightRow1 = truncateToWidth(
      dim(isLoggedOut ? 'Run /login or /provider to get started.' : 'Send /help for help information.'),
      textWidth,
      '…',
    );

    let renderedHeaderLines = [
      logoRow0.padEnd(logoWidth) + gap + rightRow0,
      logoRow1.padEnd(logoWidth) + gap + rightRow1,
    ];
    if (isRainbowDancing()) {
      renderedHeaderLines = renderDanceWelcomeHeader(logo, textWidth, rightRow1);
    }

    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)('not set, run /login or /provider')
      : (effectiveActiveModel?.displayName ?? effectiveActiveModel?.model ?? this.state.model);

    const workDir =
      this.state.environment?.environmentId !== 'local' &&
      this.state.environment?.cwd !== undefined
        ? this.state.environment.cwd
        : this.state.workDir;
    const infoLines = [
      labelStyle('Directory: ') + workDir,
      labelStyle('Session:   ') + this.state.sessionId,
      labelStyle('Model:     ') + modelValue,
      labelStyle('Version:   ') + this.state.version,
    ];

    if (this.state.mcpServersSummary) {
      infoLines.push(labelStyle('MCP:       ') + this.state.mcpServersSummary);
    }

    const contentLines: string[] = [...renderedHeaderLines, '', ...infoLines];

    const lines: string[] = [
      '',
      primary('╭' + '─'.repeat(safeWidth - 2) + '╮'),
      primary('│') + ' '.repeat(safeWidth - 2) + primary('│'),
    ];

    for (const content of contentLines) {
      const truncated = truncateToWidth(content, innerWidth, '…');
      const vis = visibleWidth(truncated);
      const rightPad = Math.max(0, innerWidth - vis);
      lines.push(primary('│') + pad + truncated + ' '.repeat(rightPad) + primary('│'));
    }

    lines.push(primary('│') + ' '.repeat(safeWidth - 2) + primary('│'));
    lines.push(primary('╰' + '─'.repeat(safeWidth - 2) + '╯'));
    lines.push('');

    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }
}
