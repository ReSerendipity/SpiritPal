import { describe, it, expect } from 'vitest'
import {
  getPrompt,
  getPromptDefinition,
  getAllPromptVersions,
  getPromptRegistrySummary,
  validatePromptRegistry,
} from '../promptRegistry'

describe('promptRegistry', () => {
  describe('getPrompt', () => {
    it('should return prompt content for valid key', () => {
      const prompt = getPrompt('agent.intent')
      expect(prompt).toContain('AI Agent')
      expect(prompt.length).toBeGreaterThan(100)
    })

    it('should return empty string for invalid key', () => {
      const prompt = getPrompt('nonexistent.key')
      expect(prompt).toBe('')
    })

    it('should return all registered prompts', () => {
      const keys = [
        'agent.intent',
        'agent.react',
        'llm.emotion_select',
        'llm.memory_extract',
        'llm.character_generate',
        'memory.summarize',
        'proactive.speak',
        'character.analyze_personality',
        'vision.analyze_screen',
      ]
      for (const key of keys) {
        expect(getPrompt(key).length).toBeGreaterThan(0)
      }
    })
  })

  describe('getPromptDefinition', () => {
    it('should return full definition with version', () => {
      const def = getPromptDefinition('agent.intent')
      expect(def).toBeDefined()
      expect(def!.version).toBeGreaterThanOrEqual(1)
      expect(def!.changeLog).toBeTruthy()
      expect(def!.lastModified).toBeTruthy()
    })

    it('should return undefined for invalid key', () => {
      expect(getPromptDefinition('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllPromptVersions', () => {
    it('should return version map for all prompts', () => {
      const versions = getAllPromptVersions()
      expect(Object.keys(versions).length).toBeGreaterThanOrEqual(9)
      expect(versions['agent.intent']).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getPromptRegistrySummary', () => {
    it('should return summary array', () => {
      const summary = getPromptRegistrySummary()
      expect(Array.isArray(summary)).toBe(true)
      expect(summary.length).toBeGreaterThanOrEqual(9)
      expect(summary[0]).toHaveProperty('key')
      expect(summary[0]).toHaveProperty('version')
      expect(summary[0]).toHaveProperty('lastModified')
    })
  })

  describe('validatePromptRegistry', () => {
    it('should return empty array if all prompts are valid', () => {
      const issues = validatePromptRegistry()
      expect(issues).toEqual([])
    })
  })

  describe('placeholder substitution', () => {
    it('memory.summarize should contain {max_tokens} placeholder', () => {
      const prompt = getPrompt('memory.summarize')
      expect(prompt).toContain('{max_tokens}')
      expect(prompt).toContain('{style}')
    })

    it('llm.emotion_select should contain {available_expressions} placeholder', () => {
      const prompt = getPrompt('llm.emotion_select')
      expect(prompt).toContain('{available_expressions}')
    })

    it('agent.react should contain {tool_descriptions} placeholder', () => {
      const prompt = getPrompt('agent.react')
      expect(prompt).toContain('{tool_descriptions}')
    })
  })
})
