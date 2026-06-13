import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();

// Loads a model by URL, auto-detecting the format from its extension.
// Returns a normalized object: { scene, animations }
//   scene      -> THREE.Object3D you can add to the scene
//   animations -> THREE.AnimationClip[] (empty for OBJ; populated for glb/fbx)
export async function loadModel(url) {
  const ext = url.split(".").pop().toLowerCase();

  if (ext === "glb" || ext === "gltf") {
    const gltf = await gltfLoader.loadAsync(url);
    enableShadows(gltf.scene);
    return { scene: gltf.scene, animations: gltf.animations || [] };
  }

  if (ext === "fbx") {
    const obj = await fbxLoader.loadAsync(url);
    enableShadows(obj);
    return { scene: obj, animations: obj.animations || [] };
  }

  if (ext === "obj") {
    // If a matching .mtl sits next to the .obj, load materials first.
    const mtlUrl = url.replace(/\.obj$/i, ".mtl");
    try {
      const materials = await new MTLLoader().loadAsync(mtlUrl);
      materials.preload();
      objLoader.setMaterials(materials);
    } catch {
      // No .mtl present — that's fine, OBJ loads with default material.
    }
    const obj = await objLoader.loadAsync(url);
    objLoader.setMaterials(null); // reset for the next call
    enableShadows(obj);
    return { scene: obj, animations: [] };
  }

  throw new Error(`Unsupported model format: .${ext} (${url})`);
}

// Loads an image texture with sensible defaults for game use.
export async function loadTexture(url, { srgb = true } = {}) {
  const tex = await textureLoader.loadAsync(url);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Scale + recenter a loaded model so it fits a target height, feet on the floor.
// Handy because exported models come in wildly different units/origins.
export function fitToHeight(object3d, targetHeight) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) {
    const scale = targetHeight / size.y;
    object3d.scale.setScalar(scale);
  }
  // Recompute after scaling and drop feet to y = 0.
  const box2 = new THREE.Box3().setFromObject(object3d);
  object3d.position.y -= box2.min.y;
  return object3d;
}

function enableShadows(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}
