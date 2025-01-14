import { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

interface Label {
  div: HTMLDivElement;
  point: THREE.Vector3;
}

interface Measurement {
  points: THREE.Vector3[];
  line: THREE.Line | null;
  label: Label | null;
}

export const ARMeasure = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isARSupported, setIsARSupported] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let camera: THREE.PerspectiveCamera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let controller: THREE.XRTargetRaySpace;
    let reticle: THREE.Mesh;
    let hitTestSource: XRHitTestSource | null = null;
    const hitTestSourceRequested = false;

    // Track current measurement
    let currentMeasurement: Measurement = {
      points: [],
      line: null,
      label: null
    };

    // Store completed measurements
    const measurements: Measurement[] = [];

    const init = async () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

      // Add lights
      const ambient = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2);
      ambient.position.set(0.5, 1, 0.25);
      scene.add(ambient);

      const light = new THREE.DirectionalLight();
      light.position.set(0.2, 1, 1);
      scene.add(light);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;

      if (containerRef.current) {
        containerRef.current.appendChild(renderer.domElement);
      }

      const button = ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: containerRef.current },
      });

      document.body.appendChild(button);

      controller = renderer.xr.getController(0);
      controller.addEventListener('select', onSelect);
      scene.add(controller);

      reticle = createReticle();
      scene.add(reticle);

      window.addEventListener('resize', onWindowResize, false);

      setIsARSupported(true);
      animate();
    };

    const createReticle = () => {
      const ring = new THREE.RingGeometry(0.045, 0.05, 32).rotateX(-Math.PI / 2);
      const dot = new THREE.CircleGeometry(0.005, 32).rotateX(-Math.PI / 2);

      // Merge geometries
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        ...ring.attributes.position.array,
        ...dot.attributes.position.array
      ], 3));

      const material = new THREE.MeshBasicMaterial();
      const reticleMesh = new THREE.Mesh(geometry, material);
      reticleMesh.matrixAutoUpdate = false;
      reticleMesh.visible = false;
      return reticleMesh;
    };

    const createLine = (start: THREE.Vector3) => {
      const points = [start, start.clone()];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 5,
        linecap: 'round'
      });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      return line;
    };

    const updateLine = (matrix: THREE.Matrix4, line: THREE.Line) => {
      const positions = line.geometry.attributes.position.array;
      positions[3] = matrix.elements[12];
      positions[4] = matrix.elements[13];
      positions[5] = matrix.elements[14];
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    };

    const createLabel = (text: string, position: THREE.Vector3) => {
      if (!containerRef.current) return null;
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = text;
      containerRef.current.appendChild(label);
      return {
        div: label,
        point: position.clone()
      };
    };

    const getCenterPoint = (points: THREE.Vector3[]) => {
      const line = new THREE.Line3(points[0], points[1]);
      return line.getCenter(new THREE.Vector3());
    };

    const getDistance = (points: THREE.Vector3[]) => {
      if (points.length === 2) {
        return points[0].distanceTo(points[1]);
      }
      return 0;
    };

    const onSelect = () => {
      if (!reticle.visible) return;

      const point = new THREE.Vector3();
      point.setFromMatrixPosition(reticle.matrix);

      // Add point to current measurement
      currentMeasurement.points.push(point);

      if (currentMeasurement.points.length === 1) {
        // Start new line
        currentMeasurement.line = createLine(point);
      } else if (currentMeasurement.points.length === 2) {
        // Complete measurement
        const distance = Math.round(getDistance(currentMeasurement.points) * 100);
        const centerPoint = getCenterPoint(currentMeasurement.points);

        const label = createLabel(`${distance} cm`, centerPoint);
        currentMeasurement.label = label;

        // Store completed measurement
        measurements.push({ ...currentMeasurement });

        // Reset current measurement
        currentMeasurement = {
          points: [],
          line: null,
          label: null
        };
      }
    };

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const toScreenPosition = (point: THREE.Vector3, camera: THREE.Camera) => {
      const vec = new THREE.Vector3();
      vec.copy(point);
      vec.project(camera);

      vec.x = (vec.x + 1) * window.innerWidth / 2;
      vec.y = (-vec.y + 1) * window.innerHeight / 2;
      vec.z = 0;

      return vec;
    };

    const animate = () => {
      renderer.setAnimationLoop(render);
    };

    const render = (timestamp: number | null, frame: XRFrame | null) => {
      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (session && !hitTestSourceRequested) {
          session.requestReferenceSpace('viewer').then((refSpace) => {
            if (session.requestHitTestSource) {
              session
                .requestHitTestSource({ space: refSpace })
                .then((source) => {
                  hitTestSource = source;
                });
            }
          });
        }

        if (hitTestSource) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);

          if (hitTestResults.length) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace!);

            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);

              // Update current line if it exists
              if (currentMeasurement.line) {
                updateLine(reticle.matrix, currentMeasurement.line);
              }
            }
          } else {
            reticle.visible = false;
          }
        }

        // Update all labels
        const allLabels = [
          ...measurements.map(m => m.label).filter(Boolean),
          currentMeasurement.label
        ].filter(Boolean) as Label[];

        allLabels.forEach((label) => {
          const camera3D = renderer.xr.getCamera();
          const pos = toScreenPosition(label.point, camera3D);
          label.div.style.transform = `translate(-50%, -50%) translate(${pos.x}px,${pos.y}px)`;
        });
      }

      renderer.render(scene, camera);
    };

    init();

    return () => {
      // Cleanup
      renderer?.dispose();
      scene?.clear();

      // Remove all labels
      const allLabels = [
        ...measurements.map(m => m.label).filter(Boolean),
        currentMeasurement.label
      ].filter(Boolean) as Label[];

      allLabels.forEach((label) => label.div.remove());

      const button = document.querySelector('button');
      button?.remove();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-screen relative">
      {!isARSupported && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 text-white text-center p-4">
          <p className="text-xl">WebXR is not supported on your device</p>
        </div>
      )}
      <style>
        {`
          .label {
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
          }
        `}
      </style>
    </div>
  );
};
