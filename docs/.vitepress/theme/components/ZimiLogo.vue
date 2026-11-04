<script setup lang="ts">
import logoUrl from '../Zimi.png'

withDefaults(defineProps<{ size?: number }>(), { size: 56 })
</script>

<template>
  <img
    class="ZimiLogo"
    :src="logoUrl"
    :width="size"
    :height="size"
    alt="Zimi"
  />
</template>

<style scoped>
.ZimiLogo {
  display: block;
  object-fit: contain;
}
</style>
