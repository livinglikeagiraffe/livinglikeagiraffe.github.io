"""Versioned navigation contract used by baking, references and the web viewer."""
import math

EXPLORATION = {'version': 1, 'elevationLift': math.radians(8), 'yaw': math.radians(10)}
LEGACY_VIEWS = ('authored', 'left', 'right', 'near', 'low', 'heldout')
VIEW_IDS = ('authored', 'start', 'left', 'right', 'near', 'low', 'heldout',
            'far-nw', 'far-ne', 'far-sw', 'far-se', 'near-nw', 'near-ne', 'near-sw', 'near-se')


def pose(domain, zoom, pan=(0, 0)):
    """Coordinates in glTF axes; identical to domainPose's exploration branch."""
    t = max(0, min(1, zoom)); limit = domain['pan']
    x, y = (max(-limit, min(limit, v)) for v in pan)
    config = domain['exploration']; base = domain['azimuth']
    azimuth = base + config['yaw'] * x / max(limit, .001)
    elevation = min(1.4, domain['elevation'] + config['elevationLift']) - domain['tilt'] * t
    target = [domain['target'][0] + (math.cos(base)*x-math.sin(base)*y)*domain['span'],
              domain['target'][1],
              domain['target'][2] + (-math.sin(base)*x-math.cos(base)*y)*domain['span']]
    distance = domain['distance']*(1-.08*t)
    direction = (math.sin(azimuth)*math.cos(elevation), math.sin(elevation), math.cos(azimuth)*math.cos(elevation))
    return {'position': [target[i]+direction[i]*distance for i in range(3)], 'target': target,
            'zoom': 1+(domain['zoomMax']-1)*t, 'azimuth': azimuth, 'elevation': elevation}


def reference_poses(domain):
    p = domain['pan']
    result = [('authored', 0, 0, 0), ('start', 0, 0, 0), ('left', -p, 0, .35), ('right', p, 0, .35),
              ('near', 0, 0, 1), ('low', .10, .08, .75), ('heldout', -.07, -.06, .57)]
    for prefix, zoom in [('far', 0), ('near', 1)]:
        result += [(prefix+'-'+suffix, x*p, y*p, zoom) for suffix, x, y in [('nw',-1,-1),('ne',1,-1),('sw',-1,1),('se',1,1)]]
    return result


def set_ranges(domain, corners):
    """Orthographic rays are exact; perspective ranges cover every bounding-box corner.

    Pan is affine; yaw and zoom are sampled densely with a 2 degree guard band
    for perspective scenes. Large/near-camera scenes can need more cache density.
    """
    domain['exploration'] = dict(EXPLORATION)
    top = min(1.4, domain['elevation']+EXPLORATION['elevationLift'])
    domain['azimuthRange'] = [domain['azimuth']-EXPLORATION['yaw'], domain['azimuth']+EXPLORATION['yaw']]
    domain['elevationRange'] = [min(domain['elevation'], top-domain['tilt']), max(domain['elevation'], top)]
    if domain['projection'] == 'PERSP':
        azimuths = domain['azimuthRange'][:]; elevations = domain['elevationRange'][:]
        for xi in range(17):
            for y in (-domain['pan'], domain['pan']):
                for t in (0, .25, .5, .75, 1):
                    eye = pose(domain, t, ((xi/8-1)*domain['pan'], y))['position']
                    for point in corners:
                        ray = [eye[k]-point[k] for k in range(3)]; length=math.sqrt(sum(v*v for v in ray))
                        az=math.atan2(ray[0],ray[2]);base=domain['azimuth']
                        azimuths.append(base+math.atan2(math.sin(az-base),math.cos(az-base)))
                        elevations.append(math.asin(max(-1,min(1,ray[1]/max(length,1e-9)))))
        guard=math.radians(2)
        domain['azimuthRange']=[min(azimuths)-guard,max(azimuths)+guard]
        domain['elevationRange']=[max(-1.56,min(elevations)-guard),min(1.56,max(elevations)+guard)]
    return domain
