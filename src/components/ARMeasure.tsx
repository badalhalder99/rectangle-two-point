import { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

interface Label {
  div: HTMLDivElement;
  point: THREE.Vector3;
}

interface Rectangle {
  points: THREE.Vector3[];
  lines: THREE.Line[];
  widthLabel: Label | null;
  heightLabel: Label | null;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hitTestSource: any = null;
    const hitTestSourceRequested = false;

    // Track height points (first two points)
    let heightPoints: THREE.Vector3[] = [];

    // Track current rectangle
    const currentRectangle: Rectangle = {
      points: [],
      lines: [],
      widthLabel: null,
      heightLabel: null
    };

    // Store completed rectangles
    const rectangles: Rectangle[] = [];

    const init = async () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

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
        domOverlay: { root: containerRef.current as HTMLElement },
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

    const createLine = (start: THREE.Vector3, end: THREE.Vector3) => {
      const points = [start.clone(), end.clone()];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 12,
        linecap: 'round'
      });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      return line;
    };

    const updateLine = (line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3) => {
      const positions = line.geometry.attributes.position.array as Float32Array;
      positions[0] = start.x;
      positions[1] = start.y;
      positions[2] = start.z;
      positions[3] = end.x;
      positions[4] = end.y;
      positions[5] = end.z;
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

    const getMidpoint = (point1: THREE.Vector3, point2: THREE.Vector3) => {
      return new THREE.Vector3().addVectors(point1, point2).multiplyScalar(0.5);
    };

    const getDistance = (point1: THREE.Vector3, point2: THREE.Vector3) => {
      return point1.distanceTo(point2);
    };

    const createRectangle = (basePoint: THREE.Vector3, startPoint: THREE.Vector3) => {
      if (heightPoints.length !== 2) return;

      const height = heightPoints[1].clone().sub(heightPoints[0]).length();
      const direction = heightPoints[1].clone().sub(heightPoints[0]).normalize();

      console.log(direction)

      // Calculate the upper point based on the height vector
      const upperPoint = new THREE.Vector3(
        basePoint.x,
        basePoint.y + height,
        basePoint.z
      );

      const points = [
        startPoint.clone(),
        basePoint.clone(),
        upperPoint.clone(),
        new THREE.Vector3(
          startPoint.x,
          startPoint.y + height,
          startPoint.z
        )
      ];

      const lines = [
        createLine(points[0], points[1]),
        createLine(points[1], points[2]),
        createLine(points[2], points[3]),
        createLine(points[3], points[0])
      ];

      const width = Math.round(getDistance(points[0], points[1]) * 100);
      const heightInCm = Math.round(height * 100);

      const widthMidpoint = getMidpoint(points[0], points[1]);
      const heightMidpoint = getMidpoint(points[1], points[2]);

      const widthLabel = createLabel(`Width: ${width} cm`, widthMidpoint);
      const heightLabel = createLabel(`Height: ${heightInCm} cm`, heightMidpoint);

      const rectangle: Rectangle = {
        points: points.map(p => p.clone()),
        lines,
        widthLabel,
        heightLabel
      };

      rectangles.push(rectangle);
      return rectangle;
    };

    const onSelect = () => {
      if (!reticle.visible) return;

      const point = new THREE.Vector3();
      point.setFromMatrixPosition(reticle.matrix);

      if (heightPoints.length < 2) {
        // Setting up height points
        heightPoints.push(point.clone());
        if (heightPoints.length === 2) {
          // Create initial height line
          createLine(heightPoints[0], heightPoints[1]);
        }
      } else {
        // Create rectangles based on the number of points
        if (rectangles.length === 0) {
          // Third point - create first rectangle
          createRectangle(point, heightPoints[0]);
        } else if (rectangles.length === 1) {
          // Fourth point - create rectangle connected to third point
          const lastRectangle = rectangles[rectangles.length - 1];
          createRectangle(point, lastRectangle.points[1]);
        } else if (rectangles.length === 2) {
          // Fifth point - create two rectangles
          const lastRectangle = rectangles[rectangles.length - 1];
          // Create rectangle connected to fourth point
          createRectangle(point, lastRectangle.points[1]);
          // Create rectangle connected back to height points
          createRectangle(point, heightPoints[0]);

          // Reset for new measurements
          heightPoints = [];
        }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = (timestamp: number | null, frame: any) => {
      console.log(timestamp);

      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session:any = renderer.xr.getSession();

        if (session && !hitTestSourceRequested) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          session.requestReferenceSpace('viewer').then((refSpace:any) => {
            if (session.requestHitTestSource) {
              session
                .requestHitTestSource({ space: refSpace })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((source:any) => {
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

              // Show preview line for height points
              if (heightPoints.length === 1) {
                const previewPoint = new THREE.Vector3();
                previewPoint.setFromMatrixPosition(reticle.matrix);

                if (currentRectangle.lines.length > 0) {
                  const lastLine = currentRectangle.lines[currentRectangle.lines.length - 1];
                  updateLine(lastLine, heightPoints[0], previewPoint);
                } else {
                  const line = createLine(heightPoints[0], previewPoint);
                  currentRectangle.lines.push(line);
                }
              }
            }
          } else {
            reticle.visible = false;
          }
        }

        // Update all labels
        const allLabels = rectangles.flatMap(rect =>
          [rect.widthLabel, rect.heightLabel].filter(Boolean)
        ) as Label[];

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
      const allLabels = rectangles.flatMap(rect =>
        [rect.widthLabel, rect.heightLabel].filter(Boolean)
      ) as Label[];

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
