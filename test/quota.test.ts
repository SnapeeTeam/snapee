import {expect,it} from 'vitest';
import {isAnalysisExempt} from '../src/quota';
it('matches exact normalized accounts',()=>expect(isAnalysisExempt('One@EXAMPLE.COM',' two@example.com, one@example.com ')).toBe(true));
it.each(['one+extra@example.com','other@example.com','one@example.com.attacker.test','', 'invalid'])('does not exempt other accounts %s',email=>expect(isAnalysisExempt(email,'one@example.com')).toBe(false));
it('keeps limits when no allowlist is configured',()=>expect(isAnalysisExempt('one@example.com')).toBe(false));
