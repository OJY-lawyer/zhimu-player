import assert from 'node:assert/strict'
import {
  CHATGPT_GUIDE_LABEL,
  cleanGuideMarkdown,
  guideProviderLabel,
  normalizeGuideProvider,
  validateGuideMarkdown,
} from '../src/shared/guideGeneration'

assert.equal(normalizeGuideProvider(undefined), 'chatgpt-web')
assert.equal(normalizeGuideProvider('deepseek-reasoner'), 'chatgpt-web')
assert.equal(normalizeGuideProvider('compatible-api'), 'compatible-api')
assert.equal(guideProviderLabel('chatgpt-web', 'deepseek-reasoner'), CHATGPT_GUIDE_LABEL)
assert.equal(guideProviderLabel('compatible-api', 'deepseek-v4-flash'), 'API · deepseek-v4-flash')

const fenced = '```markdown\n# 导读\n\n### 话题 [P1-00:02:03]\n内容\n```'
assert.equal(cleanGuideMarkdown(fenced), '# 导读\n\n### 话题 [P1-00:02:03]\n内容')
assert.equal(validateGuideMarkdown(fenced, 1), null)
assert.match(validateGuideMarkdown('### 话题 [P1-02:03]\n内容', 1) || '', /严格/)
assert.match(validateGuideMarkdown('### 话题 [P2-00:02:03]\n内容', 1) || '', /不存在/)

console.log('guide-generation: ok')
