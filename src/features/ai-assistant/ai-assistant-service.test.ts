import { describe, expect, it } from 'vitest';
import { normalizeAssistantText } from './ai-assistant-service';

describe('AI assistant text normalization', () => {
    it('removes markdown emphasis markers from assistant text', () => {
        expect(normalizeAssistantText('1) **Which chain** are you on?\n2) Use *all severities*.')).toBe(
            '1) Which chain are you on?\n2) Use all severities.'
        );
    });

    it('converts markdown bullet asterisks to plain list markers', () => {
        expect(normalizeAssistantText('* Chain\n* Severity')).toBe('- Chain\n- Severity');
    });
});
