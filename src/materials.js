import * as THREE from 'three';
import { whitePanels, metalPanels, floorTiles } from './textures.js';

// Surface materials, keyed by the names used in the level definition.
export function createMaterials(renderer, textureSize = 1024) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const white = whitePanels(textureSize);
  const metal = metalPanels(textureSize);
  const floor = floorTiles(textureSize);
  for (const set of [white, metal, floor]) {
    for (const t of Object.values(set)) if (t) t.anisotropy = aniso;
  }

  return {
    white: new THREE.MeshStandardMaterial({
      map: white.map,
      normalMap: white.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.6,
    }),
    whiteFloor: new THREE.MeshStandardMaterial({
      map: white.map,
      normalMap: white.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      color: 0xd6d8da,
      roughness: 0.55,
      metalness: 0,
      envMapIntensity: 0.6,
    }),
    metal: new THREE.MeshStandardMaterial({
      map: metal.map,
      normalMap: metal.normalMap,
      roughnessMap: metal.roughnessMap,
      roughness: 1,
      metalness: 0.55,
      envMapIntensity: 0.9,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: floor.map,
      normalMap: floor.normalMap,
      roughnessMap: floor.roughnessMap,
      roughness: 1,
      metalness: 0.25,
      envMapIntensity: 0.7,
    }),
  };
}
