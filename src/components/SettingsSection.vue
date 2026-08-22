<template>
  <!-- No horizontal padding: the Sheet body already owns the gutter. -->
  <section class="py-4 border-b border-rule last:border-b-0">
    <h3 class="section-label">{{ title }}</h3>
    <div class="mt-1.5">
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true }
});
</script>
