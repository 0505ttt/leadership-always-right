/** Approved runtime files only. Same-named historical Tripo candidates stay unused. */
export const runtimeCatalog = [
  ...['employee-base-v1','leader-v1','pot-v1','chair-v1','computer-set-v1','box-v1','clock-station-v1','plant-v1']
    .map(id=>({id,path:`assets/tripo/${id}.glb`})),
  ...['cake-v2','exit-door-v1','printer-v1','storage-shelf-v1','mug-v1','paper-stack-v1','stationery-v1','water-station-v1']
    .map(id=>({id,path:`assets/office-props/${id}.glb`})),
] as const;

export function runtimeAssetSpecs(base:string,version:string){
  return runtimeCatalog.map(({id,path})=>({id,url:`${base}${path}?v=${encodeURIComponent(version)}`}));
}
