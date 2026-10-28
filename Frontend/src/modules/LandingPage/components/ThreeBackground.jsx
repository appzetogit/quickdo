import React, { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'

/* ─── Floating Constellation Particles ─── */
function Constellation({ count = 90 }) {
  const pointsRef = useRef()
  const lineSegmentsRef = useRef()

  const [positions, velocities, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)

    const palette = [
      new THREE.Color('#6366F1'), // royal indigo
      new THREE.Color('#818CF8'), // lighter indigo
      new THREE.Color('#F59E0B'), // amber gold
      new THREE.Color('#ffffff'), // white
    ]

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 16
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6

      vel[i * 3 + 0] = (Math.random() - 0.5) * 0.015
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.015
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.015

      const c = palette[Math.floor(Math.random() * palette.length)]
      col[i * 3 + 0] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }

    return [pos, vel, col]
  }, [count])

  // Real-time animation of points and connection lines
  useFrame(() => {
    if (!pointsRef.current) return

    const geo = pointsRef.current.geometry
    const posArr = geo.attributes.position.array

    // Move particles inside boundary limits
    for (let i = 0; i < count; i++) {
      posArr[i * 3 + 0] += velocities[i * 3 + 0]
      posArr[i * 3 + 1] += velocities[i * 3 + 1]
      posArr[i * 3 + 2] += velocities[i * 3 + 2]

      // Bounce boundaries
      if (Math.abs(posArr[i * 3 + 0]) > 8) velocities[i * 3 + 0] *= -1
      if (Math.abs(posArr[i * 3 + 1]) > 5) velocities[i * 3 + 1] *= -1
      if (Math.abs(posArr[i * 3 + 2]) > 3) velocities[i * 3 + 2] *= -1
    }
    geo.attributes.position.needsUpdate = true

    // Rebuild line connections
    if (lineSegmentsRef.current) {
      const lineGeo = lineSegmentsRef.current.geometry
      const linePos = []
      const maxDistance = 2.4

      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = posArr[i * 3 + 0] - posArr[j * 3 + 0]
          const dy = posArr[i * 3 + 1] - posArr[j * 3 + 1]
          const dz = posArr[i * 3 + 2] - posArr[j * 3 + 2]
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

          if (dist < maxDistance) {
            linePos.push(posArr[i * 3 + 0], posArr[i * 3 + 1], posArr[i * 3 + 2])
            linePos.push(posArr[j * 3 + 0], posArr[j * 3 + 1], posArr[j * 3 + 2])
          }
        }
      }

      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
      lineGeo.attributes.position.needsUpdate = true
    }
  })

  return (
    <group>
      {/* Dots */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.08}
          vertexColors
          transparent
          opacity={0.7}
          sizeAttenuation
        />
      </points>

      {/* Network Lines */}
      <lineSegments ref={lineSegmentsRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#6366F1" transparent opacity={0.12} linewidth={1} />
      </lineSegments>
    </group>
  )
}

/* ─── Sophisticated Floating Ring ─── */
function GlowingRing({ position, color, scale = 1, speed = 1 }) {
  const mesh = useRef()
  useFrame(({ clock }) => {
    if (mesh.current) {
      mesh.current.rotation.x = clock.getElapsedTime() * speed * 0.15
      mesh.current.rotation.y = clock.getElapsedTime() * speed * 0.1
    }
  })

  return (
    <Float speed={speed} rotationIntensity={0.3} floatIntensity={0.4}>
      <mesh ref={mesh} position={position} scale={scale}>
        <torusGeometry args={[1.2, 0.02, 8, 100]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
    </Float>
  )
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.8} />
      
      {/* Modern abstract network grid */}
      <Constellation count={80} />

      {/* Premium ambient rings */}
      <GlowingRing position={[-3.5, 1.8, -2]} color="#6366F1" scale={1.2} speed={0.8} />
      <GlowingRing position={[4, -1.8, -3]} color="#F59E0B" scale={1.4} speed={0.6} />
      <GlowingRing position={[1, -2.8, -2]} color="#6366F1" scale={0.9} speed={1.1} />
    </>
  )
}

export default function ThreeBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
      <Canvas
        camera={{ position: [0, 0, 7], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ width: '100%', height: '100%' }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
