/**
 * 自定义宠物添加表单组件
 *
 * 功能概述：
 * - 提供完整的自定义宠物配置表单
 * - 基本信息：名称ID、显示名称、签名短语、背景故事
 * - 精灵图配置：资源路径、类型（atlas/svg/gif）、帧尺寸
 * - 动画状态选择：支持idle/walk/sit/sleep/eat/happy/sad/sick/pet/drag
 * - 主题色配置：主色和辅色选择
 * - 表单验证：必填项检查、格式验证、数值范围
 * - 支持编辑模式（传入initialData预填充）
 * - i18n国际化支持
 *
 * 核心Hooks/状态：
 * - useState: 表单数据、验证错误、预览模式
 * - useCallback: 表单验证函数
 * - useTranslation: i18n国际化
 */
import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PetState } from '../lib/types'

// ============ 表单数据 ============

interface CustomPetFormData {
  /** 宠物名称 */
  name: string
  /** 显示名称 */
  displayName: string
  /** 来源 */
  source: string
  /** 精灵图路径 */
  spritePath: string
  /** 精灵图类型 */
  spriteType: 'atlas' | 'svg' | 'gif'
  /** 帧宽度 */
  frameWidth: number
  /** 帧高度 */
  frameHeight: number
  /** 可用状态列表 */
  states: PetState[]
  /** 主题色 */
  primaryColor: string
  /** 辅助色 */
  secondaryColor: string
  /** 签名短语 */
  signaturePhrase: string
  /** 生日背景 */
  birthBackground: string
}

/** 表单错误 */
interface FormErrors {
  [key: string]: string
}

/** 默认表单数据 */
const DEFAULT_FORM_DATA: CustomPetFormData = {
  name: '',
  displayName: '',
  source: '自定义',
  spritePath: '',
  spriteType: 'atlas',
  frameWidth: 150,
  frameHeight: 150,
  states: ['idle', 'walk', 'sit', 'sleep', 'happy', 'sad'],
  primaryColor: '#FFB6C1',
  secondaryColor: '#A777E3',
  signaturePhrase: '你好呀！',
  birthBackground: '一只由主人创造的虚拟宠物',
}

/** 所有可选状态 */
const ALL_STATES: PetState[] = [
  'idle', 'walk', 'sit', 'sleep', 'eat', 'happy', 'sad', 'sick', 'pet', 'drag',
]

// ============ 组件 ============

interface CustomPetFormProps {
  /** 提交回调 */
  onSubmit: (data: CustomPetFormData) => void
  /** 取消回调 */
  onCancel?: () => void
  /** 初始数据（编辑模式） */
  initialData?: Partial<CustomPetFormData>
}

/**
 * 自定义宠物表单组件
 *
 * 用于添加或编辑自定义宠物配置，包含完整的表单验证和数据提交。
 */
export const CustomPetForm: React.FC<CustomPetFormProps> = ({
  onSubmit,
  onCancel,
  initialData,
}) => {
  const { t } = useTranslation()
  const [formData, setFormData] = useState<CustomPetFormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  // ============ 验证 ============

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.name.trim()) {
      newErrors.name = t('customPet.validation.required')
    } else if (!/^[a-z0-9-]+$/.test(formData.name)) {
      newErrors.name = 'ID 只能包含小写字母、数字和连字符'
    }

    if (!formData.displayName.trim()) {
      newErrors.displayName = t('customPet.validation.required')
    }

    if (!formData.spritePath.trim()) {
      newErrors.spritePath = t('customPet.validation.required')
    }

    if (formData.frameWidth < 10 || formData.frameWidth > 500) {
      newErrors.frameWidth = '帧宽度应在 10-500 之间'
    }

    if (formData.frameHeight < 10 || formData.frameHeight > 500) {
      newErrors.frameHeight = '帧高度应在 10-500 之间'
    }

    if (formData.states.length === 0) {
      newErrors.states = '至少选择一个动画状态'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData, t])

  // ============ 提交 ============

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit(formData)
    }
  }

  // ============ 状态切换 ============

  const toggleState = (state: PetState) => {
    setFormData((prev) => ({
      ...prev,
      states: prev.states.includes(state)
        ? prev.states.filter((s) => s !== state)
        : [...prev.states, state],
    }))
  }

  // ============ 渲染 ============

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {/* 基本信息 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          基本信息
        </h3>

        {/* 名称 */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('customPet.name')} (ID)
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="my-custom-pet"
            className={`w-full px-2 py-1 text-sm rounded border ${
              errors.name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            } bg-white dark:bg-gray-800`}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* 显示名称 */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            显示名称
          </label>
          <input
            type="text"
            value={formData.displayName}
            onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="我的自定义宠物"
            className={`w-full px-2 py-1 text-sm rounded border ${
              errors.displayName ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            } bg-white dark:bg-gray-800`}
          />
        </div>

        {/* 签名短语 */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            签名短语
          </label>
          <input
            type="text"
            value={formData.signaturePhrase}
            onChange={(e) => setFormData((prev) => ({ ...prev, signaturePhrase: e.target.value }))}
            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          />
        </div>
      </div>

      {/* 精灵图配置 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          精灵图配置
        </h3>

        {/* 精灵图路径 */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('customPet.spritePath')}
          </label>
          <input
            type="text"
            value={formData.spritePath}
            onChange={(e) => setFormData((prev) => ({ ...prev, spritePath: e.target.value }))}
            placeholder="/pets/custom/spritesheet.webp"
            className={`w-full px-2 py-1 text-sm rounded border ${
              errors.spritePath ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            } bg-white dark:bg-gray-800`}
          />
        </div>

        {/* 精灵图类型 */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            精灵图类型
          </label>
          <select
            value={formData.spriteType}
            onChange={(e) => setFormData((prev) => ({ ...prev, spriteType: e.target.value as CustomPetFormData['spriteType'] }))}
            className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          >
            <option value="atlas">Atlas (精灵图集)</option>
            <option value="svg">SVG</option>
            <option value="gif">GIF</option>
          </select>
        </div>

        {/* 帧大小 */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('customPet.frameSize')} (宽)
            </label>
            <input
              type="number"
              value={formData.frameWidth}
              onChange={(e) => setFormData((prev) => ({ ...prev, frameWidth: Number(e.target.value) }))}
              min={10}
              max={500}
              className={`w-full px-2 py-1 text-sm rounded border ${
                errors.frameWidth ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-800`}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('customPet.frameSize')} (高)
            </label>
            <input
              type="number"
              value={formData.frameHeight}
              onChange={(e) => setFormData((prev) => ({ ...prev, frameHeight: Number(e.target.value) }))}
              min={10}
              max={500}
              className={`w-full px-2 py-1 text-sm rounded border ${
                errors.frameHeight ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-800`}
            />
          </div>
        </div>
      </div>

      {/* 动画状态 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          动画状态
        </h3>
        <div className="flex flex-wrap gap-2">
          {ALL_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => toggleState(state)}
              className={`px-2 py-1 text-xs rounded ${
                formData.states.includes(state)
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {t(`pet.${state}`, state)}
            </button>
          ))}
        </div>
        {errors.states && <p className="text-xs text-red-500">{errors.states}</p>}
      </div>

      {/* 主题色 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          主题色
        </h3>
        <div className="flex gap-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">主色</label>
            <input
              type="color"
              value={formData.primaryColor}
              onChange={(e) => setFormData((prev) => ({ ...prev, primaryColor: e.target.value }))}
              className="w-8 h-8 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">辅色</label>
            <input
              type="color"
              value={formData.secondaryColor}
              onChange={(e) => setFormData((prev) => ({ ...prev, secondaryColor: e.target.value }))}
              className="w-8 h-8 rounded cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 按钮 */}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded hover:bg-blue-600"
        >
          {t('customPet.save')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            {t('app.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

export default CustomPetForm
