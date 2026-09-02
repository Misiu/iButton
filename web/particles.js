const canvas = document.querySelector('#particles');

if (canvas && window.innerWidth > 450 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const ctx = canvas.getContext('2d');
  const color = [0, 154, 199];
  const particles = [];
  const count = 50;
  const linkDistance = 100;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createParticle() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.08 + Math.random() * 0.12;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 1 + Math.random() * 2,
      opacity: 0.3 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2
    };
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);

    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (particle.x < -5) particle.x = width + 5;
      if (particle.x > width + 5) particle.x = -5;
      if (particle.y < -5) particle.y = height + 5;
      if (particle.y > height + 5) particle.y = -5;
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= linkDistance) {
          const opacity = 0.7 * (1 - distance / linkDistance);
          ctx.strokeStyle = `rgba(${color.join(',')},${opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const particle of particles) {
      const pulse = 0.85 + Math.sin(time * 0.0015 + particle.phase) * 0.15;
      ctx.fillStyle = `rgba(${color.join(',')},${particle.opacity})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    frame = requestAnimationFrame(draw);
  }

  resize();
  for (let i = 0; i < count; i++) particles.push(createParticle());
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
    } else {
      frame = requestAnimationFrame(draw);
    }
  });
  frame = requestAnimationFrame(draw);
}
