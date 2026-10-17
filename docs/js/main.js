/**
 * 图提取 ImageGrab —— 官网交互脚本
 * 包含：导航栏吸顶、移动端菜单、滚动高亮、进入视口动画、年份更新
 */
(() => {
  'use strict';

  const navbar = document.getElementById('navbar');
  const navLinks = document.getElementById('navLinks');
  const navToggle = document.getElementById('navToggle');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 导航栏吸顶效果 ---------------- */

  function onScroll() {
    if (!navbar) return;
    navbar.classList.toggle('is-scrolled', window.scrollY > 12);
  }

  let scrollTicking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(() => {
        onScroll();
        scrollTicking = false;
      });
    },
    { passive: true }
  );
  onScroll();

  /* ---------------- 移动端菜单 ---------------- */

  function closeMenu() {
    if (!navLinks || !navToggle) return;
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', '打开导航菜单');
  }

  function openMenu() {
    if (!navLinks || !navToggle) return;
    navLinks.classList.add('is-open');
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', '关闭导航菜单');
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.contains('is-open');
      if (isOpen) closeMenu();
      else openMenu();
    });

    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('click', (event) => {
      if (!navLinks.classList.contains('is-open')) return;
      if (navLinks.contains(event.target) || navToggle.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeMenu();
    });
  }

  /* ---------------- 锚点平滑滚动 ---------------- */

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      if (history.replaceState) history.replaceState(null, '', href);
    });
  });

  /* ---------------- 滚动监听：导航高亮 ---------------- */

  const sectionIds = ['intro', 'features', 'install'];
  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const links = Array.from(document.querySelectorAll('.nav-link'));

  function setActive(id) {
    links.forEach((link) => {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );
    sections.forEach((section) => spy.observe(section));

    // 回到首屏时清除高亮，避免导航停留在最后一个区块
    window.addEventListener(
      'scroll',
      () => {
        if (window.scrollY < 220) setActive('');
      },
      { passive: true }
    );
    if (window.scrollY < 220) setActive('');
  }

  /* ---------------- 进入视口淡入上移动画 ---------------- */

  const revealItems = Array.from(document.querySelectorAll('.reveal'));

  if (!('IntersectionObserver' in window) || prefersReduced) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealer = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -40px 0px' }
    );
    revealItems.forEach((item) => revealer.observe(item));
  }

  /* ---------------- 页脚年份 ---------------- */

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
