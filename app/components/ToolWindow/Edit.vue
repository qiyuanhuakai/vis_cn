<script setup lang="ts">
import { computed } from 'vue';
import CodeContent from '../CodeContent.vue';
import { useCodeRender } from '../../utils/useCodeRender';

const props = defineProps<{
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  toolName?: string;
  diff?: string;
  index?: number;
  total?: number;
}>();

const displayContent = computed(() => {
  return props.diff ?? (typeof props.metadata?.diff === 'string' ? props.metadata.diff : '');
});

const isDiff = computed(() => {
  const c = displayContent.value;
  return c.includes('diff --git') || c.includes('---') && c.includes('+++');
});

const gutterMode = computed<'none' | 'single' | 'double'>(() => isDiff.value ? 'double' : 'single');

const { html: renderedHtml } = useCodeRender(() => ({
  code: displayContent.value,
  lang: isDiff.value ? 'diff' : 'text',
  theme: 'github-dark',
  gutterMode: gutterMode.value,
}));
</script>

<template>
  <CodeContent :html="renderedHtml" :variant="isDiff ? 'diff' : 'code'" :gutter-mode="gutterMode" />
</template>
