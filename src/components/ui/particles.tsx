import { useEffect, useRef } from "react";
import * as THREE from "three";

interface ParticlesProps {
  color?: string;
  particleCount?: number;
  particleSize?: number;
  animate?: boolean;
  className?: string;
}

export function Particles({
  color = "#df8755",
  particleCount = 1200,
  particleSize = 6,
  animate = true,
  className = "",
}: ParticlesProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let animationFrameId = 0;
    let mouseX = 0;
    let mouseY = 0;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0f1115, 0.0016);

    const camera = new THREE.PerspectiveCamera(55, 1, 2, 2000);
    camera.position.z = 1000;

    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];

    for (let i = 0; i < particleCount; i += 1) {
      vertices.push(
        2000 * Math.random() - 1000,
        1200 * Math.random() - 600,
        1600 * Math.random() - 800,
      );
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));

    const sprite = new THREE.TextureLoader().load(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAABl0RVh0U29mdHdhcmUAY2FuYXM6d2FybSBwYXJ0aWNsZXMYsWMAAAEzSURBVFjD7ZYxTsNAEEXfQAoUR0FNQ0XBAai4AKk4CA5AQ0JDwgHoKAk6Qk5AR0FBQ0WAkFgFbM9YkS3xx8sbu7Jk5DNrP7NHs5nZjRMRUQBQAZgA2AJ4AWgBfATwDPAHYBMgTWW7lFIq1zGz63rVdV2f53m+MRgM1nVdP6qq6o0kSQbA6/W6brf7d7/f/4vneT4IgqAsy7Isy/I4Ho8vAzwAqKoKh8PhYRjGfD6fP4oiu9vtXm9vb8fj8bCqqpimSZZlWX8HcADgQqPR+Gdvb+/N5XJZVVXdfb/fvwCYAWi327Ojo+PPyWQyNwC8AfiFZVm+1+t1nU6nXwC8A1iW5Waz2fw4HA6Lx+Ou4zg+ALgAyLIsy7I8BHAf4OVy2Ww2m9d1XT8A+Lvd7s1ms1sA5gDeAcyyLDcD7v8NwGg0+unp6R8MBsfz+fzfEQSBrus6c9v2FQBfAFRV1ff7/R8B/AH+AcQz2mpb2nEAAAAASUVORK5CYII=",
    );

    const material = new THREE.PointsMaterial({
      size: particleSize,
      sizeAttenuation: true,
      map: sprite,
      alphaTest: 0.08,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    material.color.setStyle(color);

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const rect = container.getBoundingClientRect();
      mouseX = event.clientX - rect.left - rect.width / 2;
      mouseY = event.clientY - rect.top - rect.height / 2;
    };

    const animateScene = () => {
      if (document.hidden) {
        animationFrameId = requestAnimationFrame(animateScene);
        return;
      }

      if (animate) {
        particles.rotation.y += 0.00045;
        particles.rotation.x = Math.sin(performance.now() * 0.00012) * 0.035;
      }

      camera.position.x += (mouseX * 0.2 - camera.position.x) * 0.035;
      camera.position.y += (-mouseY * 0.2 - camera.position.y) * 0.035;
      camera.lookAt(scene.position);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animateScene);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove);
    animateScene();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(animationFrameId);
      scene.remove(particles);
      geometry.dispose();
      material.dispose();
      sprite.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [animate, color, particleCount, particleSize]);

  return <div ref={mountRef} className={`absolute inset-0 pointer-events-none ${className}`} />;
}

export default Particles;
